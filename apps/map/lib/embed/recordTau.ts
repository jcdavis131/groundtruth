// The palette's "By meaning" threshold, kept outside the client component so the
// records eval (lib/embed/__eval__/records-eval.test.ts) can pin it without
// importing React. Since 2026-10-18 the palette ranks by the gated hybrid
// (lib/embed/gateConfig.ts) instead; this stays as the "shipped" arm the blind
// evals compare against, and as the records eval's regression guard.

/**
 * Minimum cosine for a loaded record to be shown by meaning. Measured, not picked by hand: the
 * lowest step of the records eval's sweep at which none of its 26 control queries (nothing
 * relevant loaded) shows a row, on 3,178 real records from the 16 record-vector cards. The
 * highest control top-1 there is 0.362 ("pharmacies", landing on a hospital). The eval's queries
 * were written by the same agent that chose this value, so it is an in-sample number and the
 * group stays behind ?semantic=1 until a blind query set passes.
 *
 * Run 3 (18 cards, 4,067 records, after bia-lar and wrc-communities joined): no step passes. At
 * 0.4, 6 of 37 controls show a row (0.429 to 0.506; "wind turbines" lands on BIA's "Wind River");
 * the first step with none, 0.55, has R@8 0.358 and empty 0.528, under the bars. Left at 0.4
 * pending that decision (the eval's DESIGN, "Run 3 (18 cards)").
 *
 * Run 4 (DESIGN 7.3a: both cards' record text says what the record is): still no step passes.
 * "wind turbines" drops to 0.288, but at 0.4 6 of 37 controls still show a row ("wildfire
 * perimeters" now lands on a WRC community at 0.495; four tribal controls on BIA land areas,
 * 0.428 to 0.506), and the first step with none, 0.55, has R@8 0.379 and empty 0.517. Left at 0.4
 * (DESIGN "Run 4 (7.3a)").
 *
 * Decision (Cam, 2026-10-17): "Cutoff 0.50". Run 4 at 0.5: P 0.847, R@8 0.459, empty 0.404, and
 * one control shows a row: n30 "Alaska Native corporation lands", on bia-lar at 0.506. The empty
 * bar (0.30) is missed and n30 is an accepted leak; both are pinned in the records eval so a worse
 * run still fails (DESIGN "Decision (Cam, 2026-10-17): tau 0.50"). The group stays behind
 * ?semantic=1: lifting it still needs a blind query set.
 */
export const RECORD_TAU = 0.5;
