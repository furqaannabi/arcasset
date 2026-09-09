import { Address } from "@graphprotocol/graph-ts";
import { Repaid } from "../generated/RepaymentVault/RepaymentVault";
import { Repayment, RepaymentIndex, Period, Note, NoteIndex, Originator, Borrower } from "../generated/schema";
import { loadOrCreateProtocolDay, repaymentKey, txLogId } from "./helpers";

/**
 * One Repaid can cover several periods (RepaymentVault.repay() cascades
 * overpayment forward), but the event carries only the *starting* period —
 * per-period paid totals live on Period.paid via PaymentRecorded in
 * rwa-note.ts. This handler's job is the reputation-facing record: who paid,
 * how much, on time or not, for the period repayment actually started at.
 */
export function handleRepaid(event: Repaid): void {
  const noteId = event.params.noteId.toString();
  const index = NoteIndex.load(noteId);
  if (index == null) return;
  const note = Note.load(index.note);
  if (note == null) return;

  const period = Period.load(note.id.concatI32(event.params.periodIndex));
  if (period == null) return;

  const repayment = new Repayment(txLogId(event));
  repayment.note = note.id;
  repayment.period = period.id;
  repayment.payer = event.params.payer;
  repayment.amount = event.params.amount;
  repayment.onTime = event.params.onTime;
  repayment.byThirdParty = event.params.payer.notEqual(Address.fromBytes(note.borrower));
  repayment.byOriginator = event.params.payer.equals(Address.fromBytes(note.originator));
  // Set here so the field is never null, and flipped by repayment-mandate.ts
  // if a Collected follows in this same transaction. A push repayment never
  // reaches that handler and stays false.
  repayment.collected = false;
  repayment.timestamp = event.params.timestamp;
  repayment.txHash = event.transaction.hash;
  repayment.save();

  // Collected fires later in the same transaction and knows the note and the
  // period but not this row's id, which is a log index. Leave it a way back.
  const marker = new RepaymentIndex(
    repaymentKey(event.transaction.hash, note.id, event.params.periodIndex),
  );
  marker.repayment = repayment.id;
  marker.save();

  note.totalRepaid = note.totalRepaid.plus(event.params.amount);
  note.save();

  const borrower = Borrower.load(note.borrower);
  if (borrower != null) {
    borrower.principalRepaid = borrower.principalRepaid.plus(event.params.amount);
    borrower.lastActivityAt = event.params.timestamp;
    borrower.save();
  }

  // "Cured by self" means the originator made good on a period already
  // flagged Missed — not every on-time payment they happen to make. The
  // period's status reflects whatever MarkedDelinquent last set it to, prior
  // to this repayment; markSettled flips it to Cured afterwards.
  const originator = Originator.load(note.originator);
  if (originator != null && repayment.byOriginator && period.status == "Missed") {
    originator.periodsCuredBySelf = originator.periodsCuredBySelf + 1;
    originator.save();
  }

  const day = loadOrCreateProtocolDay(event.params.timestamp);
  day.repaidAmount = day.repaidAmount.plus(event.params.amount);
  day.save();
}
