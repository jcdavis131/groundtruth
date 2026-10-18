// QCEW disclosure codes. BLS documents one, "N": the cell does not meet its
// disclosure standards and every value on the row is withheld. The open-data
// slices also carry an undocumented "-" whose rows hold literal zeros: every
// private-sector row of the Austin MSA slice for 2025 Q4
// (https://data.bls.gov/cew/data/api/2025/4/area/C1242.csv) reads "-" with
// 0 establishments and 0 jobs, against 1,321,014 jobs on the published total
// row of the same file. Reading those zeros as "no jobs" would be wrong, so
// any non-blank code means withheld and the row's values are null.

/** True when a QCEW disclosure_code withholds the row: any non-blank code ("N", "-", ...). */
export function isWithheld(code: string | null | undefined): boolean {
  return String(code ?? "").trim() !== "";
}
