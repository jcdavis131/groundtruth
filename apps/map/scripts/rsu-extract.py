#!/usr/bin/env python3
"""
RSU extraction from SEC Form 4 XML filings.

Parses insider transaction reports to extract Restricted Stock Unit (RSU)
grants, vesting events, and dispositions.

Form 4 structure:
- <reportingOwner>: who filed (name, CIK, relationship to issuer)
- <nonDerivativeTable>: direct stock holdings/transactions
- <derivativeTable>: options, RSUs, and other derivatives

RSU transaction codes:
- A: Grant/award
- M: Vesting (exercise/conversion to common stock)
- S: Open-market sale
- F: Tax withholding (shares withheld for taxes on vest)
- D: Disposition to issuer

Usage:
    python3 rsu-extract.py filing.xml
    python3 rsu-extract.py --dir /path/to/form4/files/
"""

import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass
class RSUTransaction:
    """A single RSU-related transaction from Form 4."""
    filer_name: str
    filer_cik: str
    issuer_name: str
    issuer_cik: str
    issuer_ticker: str
    security_title: str
    transaction_date: str
    transaction_code: str
    shares: float
    price: float | None
    shares_owned_after: float | None
    direct_or_indirect: str
    # Derived
    event_type: str  # grant | vest | sale | tax_withhold | other
    footnotes: list[str]


def is_rsu(security_title: str) -> bool:
    """Check if a security title indicates RSUs."""
    t = security_title.lower()
    return any(kw in t for kw in [
        'restricted stock unit',
        'rsu',
        'restricted share unit',
        'performance share',  # PSUs are similar
        'deferred stock unit',
    ])


def classify_event(code: str, title: str) -> str:
    """Classify transaction into event type."""
    code = code.strip().upper()
    if code == 'A':
        return 'grant'
    elif code == 'M':
        return 'vest'
    elif code == 'S':
        return 'sale'
    elif code == 'F':
        return 'tax_withhold'
    elif code == 'D':
        return 'disposition'
    return 'other'


def get_text(elem, tag: str, default: str = '') -> str:
    """Safely get text from XML element."""
    child = elem.find(tag)
    if child is not None and child.text:
        return child.text.strip()
    return default


def parse_form4(xml_path: Path) -> list[RSUTransaction]:
    """Parse a Form 4 XML file and extract RSU transactions."""
    tree = ET.parse(xml_path)
    root = tree.getroot()

    # Issuer info
    issuer_cik = get_text(root, 'issuerCik')
    issuer_name = get_text(root, 'issuerName')
    issuer_ticker = get_text(root, 'issuerTradingSymbol')

    # Reporting owner (filer)
    owner = root.find('reportingOwner')
    filer_name = ''
    filer_cik = ''
    if owner is not None:
        rpt_id = owner.find('reportingOwnerId')
        if rpt_id is not None:
            filer_cik = get_text(rpt_id, 'rptOwnerCik')
            filer_name = get_text(rpt_id, 'rptOwnerName')

    transactions = []

    # Parse both tables for RSUs
    for table_tag in ['nonDerivativeTable', 'derivativeTable']:
        table = root.find(table_tag)
        if table is None:
            continue

        for txn in table.findall('nonDerivativeTransaction') + table.findall('derivativeTransaction'):
            sec_title = get_text(txn, 'securityTitle/value') or get_text(txn, 'securityTitle')

            if not is_rsu(sec_title):
                continue

            txn_date = get_text(txn, 'transactionDate/value')
            txn_coding = txn.find('transactionCoding')
            txn_code = get_text(txn_coding, 'transactionCode') if txn_coding is not None else ''

            amounts = txn.find('transactionAmounts')
            shares = 0.0
            price = None
            acquired_disp = ''
            if amounts is not None:
                shares_text = get_text(amounts, 'transactionShares/value')
                try:
                    shares = float(shares_text.replace(',', '')) if shares_text else 0.0
                except ValueError:
                    pass
                price_text = get_text(amounts, 'transactionPricePerShare/value')
                try:
                    price = float(price_text.replace(',', '')) if price_text else None
                except ValueError:
                    pass
                acquired_disp = get_text(amounts, 'transactionAcquiredDisposedCode/value')

            # Adjust shares sign based on acquired/disposed
            if acquired_disp == 'D':
                shares = -shares

            ownership = txn.find('ownershipNature')
            direct_indirect = get_text(ownership, 'directOrIndirectOwnership/value') if ownership is not None else ''

            post_txn = txn.find('postTransactionAmounts')
            shares_after = None
            if post_txn is not None:
                after_text = get_text(post_txn, 'sharesOwnedFollowingTransaction/value')
                try:
                    shares_after = float(after_text.replace(',', '')) if after_text else None
                except ValueError:
                    pass

            # Footnotes
            footnotes = []
            for fn in txn.findall('footnoteIds/footnoteId'):
                if fn.text:
                    footnotes.append(fn.text.strip())

            transactions.append(RSUTransaction(
                filer_name=filer_name,
                filer_cik=filer_cik,
                issuer_name=issuer_name,
                issuer_cik=issuer_cik,
                issuer_ticker=issuer_ticker,
                security_title=sec_title,
                transaction_date=txn_date,
                transaction_code=txn_code,
                shares=shares,
                price=price,
                shares_owned_after=shares_after,
                direct_or_indirect=direct_indirect,
                event_type=classify_event(txn_code, sec_title),
                footnotes=footnotes,
            ))

    return transactions


def main():
    parser = argparse.ArgumentParser(description='Extract RSU transactions from Form 4 XML')
    parser.add_argument('path', help='Form 4 XML file or directory')
    parser.add_argument('--json', action='store_true', help='Output as JSON')
    args = parser.parse_args()

    path = Path(args.path)
    files = [path] if path.is_file() else list(path.glob('*.xml'))

    all_txns = []
    for f in files:
        try:
            txns = parse_form4(f)
            all_txns.extend(txns)
        except Exception as e:
            print(f'Error parsing {f}: {e}', file=sys.stderr)

    if args.json:
        print(json.dumps([asdict(t) for t in all_txns], indent=1))
    else:
        for t in all_txns:
            print(f'{t.transaction_date} {t.event_type:12} {t.shares:10,.0f} shares  '
                  f'{t.filer_name} @ {t.issuer_ticker} ({t.security_title[:40]})')
        print(f'\n{len(all_txns)} RSU transactions found')


if __name__ == '__main__':
    main()
