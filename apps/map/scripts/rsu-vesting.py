#!/usr/bin/env python3
"""
Vesting schedule inference from Form 4 footnotes and proxy statements.

Form 4 grants don't include structured vesting data. The terms are in:
1. Footnotes (e.g., "These RSUs vest in four equal annual installments")
2. Proxy statements (Grants of Plan-Based Awards table)
3. 10-K (equity compensation plan descriptions)

This module extracts vesting schedules from unstructured text using patterns.

Blackout periods: NOT in SEC filings. They are internal company policy.
This module explicitly marks blackout as "not publicly disclosed" rather
than inferring standard windows.
"""

import re
from dataclasses import dataclass
from datetime import date, timedelta


@dataclass
class VestingEvent:
    """A single vesting event in a schedule."""
    vest_date: str  # YYYY-MM-DD
    shares: float
    percent: float  # percent of total grant


@dataclass
class VestingSchedule:
    """Inferred vesting schedule for an RSU grant."""
    grant_date: str
    total_shares: float
    events: list[VestingEvent]
    source: str  # footnote | proxy | inferred | unknown
    confidence: str  # high | medium | low
    raw_text: str


# Patterns for common vesting language
VEST_PATTERNS = [
    # "vest in four equal annual installments"
    (r'vest[s]?\s+in\s+(\w+)\s+equal\s+(annual|yearly|quarterly|monthly)\s+installments?',
     'equal_installments'),
    # "25% per year over four years"
    (r'(\d+)%\s+per\s+(year|annum)\s+over\s+(\w+)\s+years?',
     'percent_per_year'),
    # "one-fourth on each anniversary"
    (r'one-(fourth|third|half)\s+on\s+each\s+(anniversary|annual)',
     'fraction_anniversary'),
    # "cliff vest on [date]"
    (r'cliff\s+vest[s]?\s+(?:on|upon)\s+(\w+\s+\d{1,2},?\s+\d{4})',
     'cliff'),
    # "vests on [date]"
    (r'vest[s]?\s+on\s+(\w+\s+\d{1,2},?\s+\d{4})',
     'specific_date'),
]

NUMBER_WORDS = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
    'fourth': 4, 'third': 3, 'half': 2,
}


def word_to_num(word: str) -> int | None:
    """Convert number word to int."""
    word = word.lower().strip()
    if word.isdigit():
        return int(word)
    return NUMBER_WORDS.get(word)


def infer_schedule(grant_date: str, total_shares: float,
                   footnote_text: str) -> VestingSchedule:
    """
    Infer vesting schedule from footnote text.
    
    Returns a VestingSchedule with confidence level.
    If no pattern matches, returns unknown with empty events.
    """
    text = footnote_text.lower()
    
    for pattern, kind in VEST_PATTERNS:
        m = re.search(pattern, text, re.IGNORECASE)
        if not m:
            continue
            
        try:
            if kind == 'equal_installments':
                num = word_to_num(m.group(1))
                period = m.group(2).lower()
                if not num:
                    continue
                    
                events = []
                grant = date.fromisoformat(grant_date)
                shares_per = total_shares / num
                
                for i in range(num):
                    if period in ('annual', 'yearly'):
                        vest = date(grant.year + i + 1, grant.month, grant.day)
                    elif period == 'quarterly':
                        # Approximate: add 3 months * (i+1)
                        month = grant.month + 3 * (i + 1)
                        year = grant.year + (month - 1) // 12
                        month = (month - 1) % 12 + 1
                        vest = date(year, month, grant.day)
                    else:  # monthly
                        month = grant.month + i + 1
                        year = grant.year + (month - 1) // 12
                        month = (month - 1) % 12 + 1
                        vest = date(year, month, min(grant.day, 28))
                    
                    events.append(VestingEvent(
                        vest_date=vest.isoformat(),
                        shares=round(shares_per, 2),
                        percent=round(100.0 / num, 2),
                    ))
                
                return VestingSchedule(
                    grant_date=grant_date,
                    total_shares=total_shares,
                    events=events,
                    source='footnote',
                    confidence='high',
                    raw_text=footnote_text[:200],
                )
                
            elif kind == 'cliff':
                # Single vest date
                # (Date parsing would go here - simplified)
                return VestingSchedule(
                    grant_date=grant_date,
                    total_shares=total_shares,
                    events=[],
                    source='footnote',
                    confidence='medium',
                    raw_text=footnote_text[:200],
                )

            elif kind == 'percent_per_year':
                # e.g., "25% per year over four years"
                pct = float(m.group(1))
                num_years = word_to_num(m.group(3))
                if not num_years:
                    continue

                events = []
                grant = date.fromisoformat(grant_date)
                shares_per = total_shares * (pct / 100.0)

                for i in range(num_years):
                    vest = date(grant.year + i + 1, grant.month, grant.day)
                    events.append(VestingEvent(
                        vest_date=vest.isoformat(),
                        shares=round(shares_per, 2),
                        percent=round(pct, 2),
                    ))

                return VestingSchedule(
                    grant_date=grant_date,
                    total_shares=total_shares,
                    events=events,
                    source='footnote',
                    confidence='high',
                    raw_text=footnote_text[:200],
                )

            elif kind == 'fraction_anniversary':
                # e.g., "one-third on each anniversary"
                frac_word = m.group(1).lower()
                num_parts = word_to_num(frac_word)
                if not num_parts:
                    continue

                events = []
                grant = date.fromisoformat(grant_date)
                shares_per = total_shares / num_parts
                pct = 100.0 / num_parts

                for i in range(num_parts):
                    vest = date(grant.year + i + 1, grant.month, grant.day)
                    events.append(VestingEvent(
                        vest_date=vest.isoformat(),
                        shares=round(shares_per, 2),
                        percent=round(pct, 2),
                    ))

                return VestingSchedule(
                    grant_date=grant_date,
                    total_shares=total_shares,
                    events=events,
                    source='footnote',
                    confidence='high',
                    raw_text=footnote_text[:200],
                )
                
        except (ValueError, IndexError):
            continue
    
    # No pattern matched
    return VestingSchedule(
        grant_date=grant_date,
        total_shares=total_shares,
        events=[],
        source='unknown',
        confidence='low',
        raw_text=footnote_text[:200] if footnote_text else 'no footnote',
    )


def blackout_status() -> dict:
    """
    Blackout period disclosure status.
    
    Blackout periods are internal company policy and are NOT disclosed
    in SEC filings. This function documents that explicitly rather than
    inferring standard windows.
    """
    return {
        'status': 'not_publicly_disclosed',
        'note': (
            'Corporate blackout periods (trading windows) are internal policy '
            'and are not disclosed in SEC filings. Do not infer standard '
            'quarterly blackout windows. Some companies mention the existence '
            'of a trading policy in 10-K Item 10 or proxy statements, but '
            'specific blackout dates are never published.'
        ),
        'where_to_look': [
            '10-K Part III Item 10 (sometimes mentions insider trading policy)',
            'Proxy DEF 14A (sometimes references trading policy)',
            'Company investor relations (not SEC-filed)',
        ],
    }


if __name__ == '__main__':
    # Test
    tests = [
        ("2026-03-15", 10000, "These restricted stock units vest in four equal annual installments beginning on March 15, 2027."),
        ("2026-01-01", 4000, "25% per year over four years commencing January 1, 2027."),
        ("2026-06-01", 12000, "One-third on each anniversary of the grant date."),
    ]
    
    for grant_date, shares, footnote in tests:
        sched = infer_schedule(grant_date, shares, footnote)
        print(f"\nGrant: {grant_date}, {shares:,} shares")
        print(f"  Source: {sched.source}, Confidence: {sched.confidence}")
        for e in sched.events:
            print(f"    {e.vest_date}: {e.shares:,.0f} shares ({e.percent}%)")
    
    print("\nBlackout:", blackout_status()['status'])
