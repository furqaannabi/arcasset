import { Collected } from "../generated/RepaymentMandate/RepaymentMandate";
import { Note, NoteIndex, Repayment, RepaymentIndex } from "../generated/schema";
import { repaymentKey } from "./helpers";

/**
 * Marks a repayment as pulled rather than pushed.
 *
 * RepaymentMandate.collect() pays the vault and *then* announces itself, so by
 * the time this runs the Repaid it caused has already been indexed — which is
 * why this handler patches a row instead of creating one, and why Repayment is
 * a mutable entity.
 *
 * The event's `value` is deliberately not stored. It is the 6-decimal ERC-20
 * face of the same money `Repayment.amount` already holds in 18-decimal native
 * units; the two differ by 1e12, and a schema carrying both is a schema where
 * someone eventually reads the wrong one.
 */
export function handleCollected(event: Collected): void {
  const index = NoteIndex.load(event.params.noteId.toString());
  if (index == null) return;
  const note = Note.load(index.note);
  if (note == null) return;

  const marker = RepaymentIndex.load(
    repaymentKey(event.transaction.hash, note.id, event.params.periodIndex),
  );
  // No marker means the repayment this collection paid for was not indexed —
  // a note minted before the start block, say. Nothing to mark, and inventing
  // a Repayment here would be a second source of truth for the same payment.
  if (marker == null) return;

  const repayment = Repayment.load(marker.repayment);
  if (repayment == null) return;

  repayment.collected = true;
  repayment.save();
}
