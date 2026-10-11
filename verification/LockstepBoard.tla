---------------------------- MODULE LockstepBoard ----------------------------
(*
  Model of online play through the relay (a write-once message board per game).

  Every player's browser holds its own copy of the game. A player posts orders for the turn they are on. The host may
  post "skip" for a player who has not answered. A browser plays a turn once the board holds an entry for every seat, using
  exactly the entries on the board at that moment, and then moves to the next turn.

  Atomic = TRUE : the board is write-once (a Durable Object: requests to a room are serialized).
  Atomic = FALSE: a write can overwrite an existing entry, like two racing writes to an eventually consistent store.

  Property that matters: two browsers never play the same turn from different entries (Agreement).
  If they did, their games would diverge and nothing would repair it except a replay.
*)
EXTENDS Naturals, FiniteSets

CONSTANTS Seats, MaxTurn, Atomic

Host == 1
Turns == 1..MaxTurn
Entry == {"none", "orders", "skip"}
Snapshot == [Seats -> Entry]
Unset == [s \in Seats |-> "none"]   \* "not played yet" (a played turn never has a "none" in it)

VARIABLES
  board,    \* board[t][s]: what the relay holds for turn t, seat s
  view,     \* view[c]: the turn browser c is on
  applied   \* applied[c][t]: the entries browser c used to play turn t, or Unset

vars == <<board, view, applied>>

TypeOK ==
  /\ board \in [Turns -> Snapshot]
  /\ view \in [Seats -> Turns]
  /\ applied \in [Seats -> [Turns -> Snapshot]]

Init ==
  /\ board = [t \in Turns |-> [s \in Seats |-> "none"]]
  /\ view = [c \in Seats |-> 1]
  /\ applied = [c \in Seats |-> [t \in Turns |-> Unset]]

\* a player posts their orders for the turn they are on
Post(s) ==
  LET t == view[s] IN
  /\ \/ board[t][s] = "none"
     \/ ~Atomic /\ board[t][s] = "skip"          \* a non-atomic store lets a late write replace the skip
  /\ board' = [board EXCEPT ![t][s] = "orders"]
  /\ UNCHANGED <<view, applied>>

\* the host gives up waiting for a player on the turn the host is on
HostSkip(s) ==
  LET t == view[Host] IN
  /\ s # Host
  /\ \/ board[t][s] = "none"
     \/ ~Atomic /\ board[t][s] = "orders"        \* a non-atomic store lets the skip replace real orders
  /\ board' = [board EXCEPT ![t][s] = "skip"]
  /\ UNCHANGED <<view, applied>>

\* a browser plays its current turn from whatever is on the board, once every seat has an entry
Advance(c) ==
  LET t == view[c] IN
  /\ t < MaxTurn
  /\ \A s \in Seats : board[t][s] # "none"
  /\ applied' = [applied EXCEPT ![c][t] = board[t]]
  /\ view' = [view EXCEPT ![c] = t + 1]
  /\ UNCHANGED board

Next == \E x \in Seats : Post(x) \/ HostSkip(x) \/ Advance(x)

Spec == Init /\ [][Next]_vars /\ \A x \in Seats : WF_vars(Post(x)) /\ WF_vars(Advance(x))

(* ------------------------------ properties ------------------------------ *)

\* Two browsers that have both played turn t played it from identical entries.
Agreement ==
  \A c1, c2 \in Seats, t \in Turns :
    (applied[c1][t] # Unset /\ applied[c2][t] # Unset) => applied[c1][t] = applied[c2][t]

\* A browser only plays a turn when every seat had an entry.
NoGaps ==
  \A c \in Seats, t \in Turns : applied[c][t] # Unset => \A s \in Seats : applied[c][t][s] # "none"

\* Once an entry is on the board it never changes.
EntriesNeverChange ==
  [][\A t \in Turns, s \in Seats : board[t][s] # "none" => board'[t][s] = board[t][s]]_vars

\* Everyone eventually reaches the last turn (players keep answering, browsers keep checking the board).
EveryoneFinishes == <>(\A c \in Seats : view[c] = MaxTurn)
=============================================================================
