import { Listed, Repriced, Delisted, Bought } from "../generated/Offering/Offering";
import { Listing, Sale, Position, Note, NoteIndex, Originator } from "../generated/schema";
import { ZERO_BI, txLogId } from "./helpers";

function loadNote(noteId: string): Note | null {
  const index = NoteIndex.load(noteId);
  if (index == null) return null;
  return Note.load(index.note);
}

export function handleListed(event: Listed): void {
  const noteId = event.params.noteId.toString();
  const note = loadNote(noteId);
  if (note == null) return;

  let listing = Listing.load(note.id);
  if (listing == null) {
    listing = new Listing(note.id);
    listing.note = note.id;
    listing.amount = ZERO_BI;
    listing.listedTotal = ZERO_BI;
    listing.delistedTotal = ZERO_BI;
    listing.firstListedAt = event.block.timestamp;
  }
  listing.amount = listing.amount.plus(event.params.amount);
  listing.priceBps = event.params.priceBps;
  listing.open = true;
  listing.listedTotal = listing.listedTotal.plus(event.params.amount);
  listing.updatedAt = event.block.timestamp;
  listing.save();

  note.listedAmount = listing.amount;
  note.save();
}

export function handleRepriced(event: Repriced): void {
  const noteId = event.params.noteId.toString();
  const note = loadNote(noteId);
  if (note == null) return;

  const listing = Listing.load(note.id);
  if (listing == null) return;
  listing.priceBps = event.params.newPriceBps;
  listing.updatedAt = event.block.timestamp;
  listing.save();
}

export function handleDelisted(event: Delisted): void {
  const noteId = event.params.noteId.toString();
  const note = loadNote(noteId);
  if (note == null) return;

  const listing = Listing.load(note.id);
  if (listing == null) return;
  listing.amount = event.params.remaining;
  listing.open = event.params.remaining.gt(ZERO_BI);
  listing.delistedTotal = listing.delistedTotal.plus(event.params.amount);
  listing.updatedAt = event.block.timestamp;
  listing.save();

  note.listedAmount = listing.amount;
  note.save();
}

export function handleBought(event: Bought): void {
  const noteId = event.params.noteId.toString();
  const note = loadNote(noteId);
  if (note == null) return;

  const listing = Listing.load(note.id);
  if (listing != null) {
    // amount already excludes this purchase — Offering.buy() decrements the
    // listing before emitting, so there is no separate quantity to subtract.
    listing.amount = listing.amount.gt(event.params.amount)
      ? listing.amount.minus(event.params.amount)
      : ZERO_BI;
    listing.open = listing.amount.gt(ZERO_BI);
    listing.updatedAt = event.block.timestamp;
    listing.save();
    note.listedAmount = listing.amount;
  }
  note.soldAmount = note.soldAmount.plus(event.params.amount);
  note.save();

  const sale = new Sale(txLogId(event));
  sale.note = note.id;
  sale.buyer = event.params.buyer;
  sale.amount = event.params.amount;
  sale.paid = event.params.paid;
  sale.priceBps = event.params.priceBps;
  sale.timestamp = event.block.timestamp;
  sale.txHash = event.transaction.hash;
  sale.save();

  const positionId = note.id.concat(event.params.buyer);
  let position = Position.load(positionId);
  if (position == null) {
    position = new Position(positionId);
    position.note = note.id;
    position.holder = event.params.buyer;
    position.balance = ZERO_BI;
    position.bought = ZERO_BI;
    position.paid = ZERO_BI;
    position.claimed = ZERO_BI;
    position.firstHeldAt = event.block.timestamp;
  }
  position.bought = position.bought.plus(event.params.amount);
  position.paid = position.paid.plus(event.params.paid);
  // balance itself is tracked by the Transfer handler in rwa-note.ts, which
  // fires for this same transfer — never double-add the amount here.
  position.save();

  const originator = Originator.load(note.originator);
  if (originator != null) {
    originator.principalSold = originator.principalSold.plus(event.params.paid);
    originator.lastActivityAt = event.block.timestamp;
    originator.save();
  }
}
