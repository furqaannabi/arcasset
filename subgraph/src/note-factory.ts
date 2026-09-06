import { Address, BigInt } from "@graphprotocol/graph-ts";
import { NoteIssued } from "../generated/NoteFactory/NoteFactory";
import { RWANote as RWANoteTemplate } from "../generated/templates";
import { RWANote as RWANoteContract } from "../generated/templates/RWANote/RWANote";
import { Note, NoteIndex, Period, Proposal, Originator, Position } from "../generated/schema";
import { idFromBigInt, ZERO_BI, loadOrCreateProtocolDay } from "./helpers";

const BPS = BigInt.fromI32(10_000);

export function handleNoteIssued(event: NoteIssued): void {
  const noteAddress = event.params.note;
  const mintedAt = event.block.timestamp;
  const periodCount = event.params.periodCount;
  const periodLength = event.params.periodLength;
  const principal = event.params.principal;
  const couponBps = event.params.couponBps;

  // gracePeriod, cureWindow and servicingFeeBps are on Terms but not on
  // NoteIssued — the event was sized around what the agent and the intel API
  // need first. One call, once, at mint: cheap next to indexing every period
  // by hand, and the alternative is a second contract change to widen the
  // event for three fields that never change afterwards.
  const contract = RWANoteContract.bind(noteAddress);
  const termsCall = contract.try_terms();
  const gracePeriod = termsCall.reverted ? ZERO_BI : termsCall.value.gracePeriod;
  const cureWindow = termsCall.reverted ? ZERO_BI : termsCall.value.cureWindow;
  const servicingFeeBps = termsCall.reverted ? 0 : termsCall.value.servicingFeeBps;

  const note = new Note(noteAddress);
  note.noteId = event.params.noteId;
  note.proposal = idFromBigInt(event.params.proposalId);
  note.originator = event.params.originator;
  note.borrower = event.params.borrower;
  note.documentHash = event.params.documentHash;
  note.agent = null;

  note.principal = principal;
  note.couponBps = couponBps;
  note.servicingFeeBps = servicingFeeBps;
  note.periodCount = periodCount;
  note.periodLength = periodLength;
  note.gracePeriod = gracePeriod;
  note.cureWindow = cureWindow;

  note.status = "Active";
  note.mintedAt = mintedAt;
  note.closedAt = null;

  note.listedAmount = ZERO_BI;
  note.soldAmount = ZERO_BI;
  note.originatorRetained = principal;

  note.periodsSettled = 0;
  note.periodsMissed = 0;
  note.totalRepaid = ZERO_BI;
  note.totalDistributed = ZERO_BI;
  note.servicingFeesPaid = ZERO_BI;
  note.save();

  const index = new NoteIndex(event.params.noteId.toString());
  index.note = note.id;
  index.save();

  // Mirrors RWANote.periodBounds/periodDue exactly — see contracts/src/RWANote.sol.
  // The schedule is knowable in full the moment the note exists, so it is
  // computed once here rather than re-derived at every query.
  const coupon = principal.times(BigInt.fromI32(couponBps)).div(BPS);
  for (let i = 0; i < periodCount; i++) {
    const period = new Period(noteAddress.concatI32(i));
    period.note = note.id;
    period.index = i;
    const start = mintedAt.plus(periodLength.times(BigInt.fromI32(i)));
    period.start = start;
    period.end = start.plus(periodLength);
    period.due = i == periodCount - 1 ? coupon.plus(principal) : coupon;
    period.paid = ZERO_BI;
    period.status = "Pending";
    period.settledAt = null;
    period.latenessSeconds = null;
    period.distributed = null;
    period.servicingFee = null;
    period.save();
  }

  const proposal = Proposal.load(idFromBigInt(event.params.proposalId));
  if (proposal != null) {
    proposal.status = "Minted";
    proposal.note = note.id;
    proposal.save();
  }

  const originator = Originator.load(event.params.originator);
  if (originator != null) {
    originator.notesMinted = originator.notesMinted + 1;
    originator.principalRaised = originator.principalRaised.plus(principal);
    originator.lastActivityAt = mintedAt;
    originator.save();
  }

  // The constructor's own Transfer(0x0, originator, principal) fires inside
  // this same transaction but strictly before NoteIssued, and the RWANote
  // template is not instantiated until the `create` call below — a dynamic
  // data source only sees events from its creation point forward, so that
  // mint Transfer would otherwise be silently missed. Seed the position here
  // instead of relying on the template to catch its own genesis event.
  const position = new Position(noteAddress.concat(event.params.originator));
  position.note = note.id;
  position.holder = event.params.originator;
  position.balance = principal;
  position.bought = ZERO_BI;
  position.paid = ZERO_BI;
  position.claimed = ZERO_BI;
  position.firstHeldAt = mintedAt;
  position.save();

  const day = loadOrCreateProtocolDay(mintedAt);
  day.notesIssued = day.notesIssued + 1;
  day.principalRaised = day.principalRaised.plus(principal);
  day.save();

  // Addresses are not known until this event fires — instantiate the
  // per-note data source now so its own events start indexing.
  RWANoteTemplate.create(noteAddress);
}
