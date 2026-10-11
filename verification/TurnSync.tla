------------------------------ MODULE TurnSync ------------------------------
(*
  Model of the turn handshake in Sector Dominion multiplayer.

  One host and some guests, each guest on an ordered reliable channel (a WebRTC data
  channel). Every living human must say "ready" before the host plays the turn.
  Guests send ready/unready messages. The host processes them one at a time, advances the
  turn when everyone is ready, and broadcasts the new turn number. A guest can disconnect
  at any time, and the host notices later and hands that empire to the AI.

  TagTurns = FALSE: messages carry no turn number (how the first version worked).
  TagTurns = TRUE : the host rejects a message that was sent from an older turn.

  This checks the protocol design, not the JavaScript.
*)
EXTENDS Naturals, Sequences, FiniteSets, TLC

CONSTANTS Guests, Host, MaxTurn, MaxQ, TagTurns

Players == Guests \cup {Host}
Sym == Permutations(Guests)

VARIABLES
  turn,          \* host's turn number
  ready,         \* host's table: who has said ready this turn
  rdyTurn,       \* history: turn the sender had seen when it sent the message behind ready[p]
  human,         \* who the host still waits for (not handed to the AI)
  connected,     \* is the guest's channel up
  toHost,        \* guest -> host queues
  toGuest,       \* host -> guest queues (new turn numbers)
  view,          \* turn number each guest last saw
  advancedWith   \* history: at the last turn advance, was every human ready

vars == <<turn, ready, rdyTurn, human, connected, toHost, toGuest, view, advancedWith>>

Msg == [kind : {"ready", "unready"}, seen : 1..MaxTurn]

TypeOK ==
  /\ turn \in 1..MaxTurn
  /\ ready \in [Players -> BOOLEAN]
  /\ rdyTurn \in [Players -> 1..MaxTurn]
  /\ human \in [Players -> BOOLEAN]
  /\ connected \in [Guests -> BOOLEAN]
  /\ \A g \in Guests : toHost[g] \in Seq(Msg) /\ toGuest[g] \in Seq(1..MaxTurn)
  /\ view \in [Guests -> 1..MaxTurn]
  /\ advancedWith \in [Players -> BOOLEAN]

Init ==
  /\ turn = 1
  /\ ready = [p \in Players |-> FALSE]
  /\ rdyTurn = [p \in Players |-> 1]
  /\ human = [p \in Players |-> TRUE]
  /\ connected = [g \in Guests |-> TRUE]
  /\ toHost = [g \in Guests |-> <<>>]
  /\ toGuest = [g \in Guests |-> <<>>]
  /\ view = [g \in Guests |-> 1]
  /\ advancedWith = [p \in Players |-> TRUE]

AllReady(r, h) == \A p \in Players : h[p] => r[p]

\* Install a new ready table; if everybody is ready, play the turn and tell the guests.
Advance(r, rt, h) ==
  IF AllReady(r, h) /\ turn < MaxTurn
  THEN /\ turn' = turn + 1
       /\ ready' = [p \in Players |-> FALSE]
       /\ rdyTurn' = [p \in Players |-> turn + 1]
       /\ advancedWith' = [p \in Players |-> ~h[p] \/ r[p]]
       /\ toGuest' = [g \in Guests |-> IF connected[g] /\ h[g]
                                         THEN Append(toGuest[g], turn + 1) ELSE toGuest[g]]
  ELSE /\ ready' = r
       /\ rdyTurn' = rt
       /\ UNCHANGED <<turn, advancedWith, toGuest>>

HostSetReady(v) ==
  /\ human[Host] /\ ready[Host] # v
  /\ Advance([ready EXCEPT ![Host] = v], [rdyTurn EXCEPT ![Host] = turn], human)
  /\ UNCHANGED <<human, connected, toHost, view>>

GuestSend(g, k) ==
  /\ connected[g] /\ Len(toHost[g]) < MaxQ
  /\ toHost' = [toHost EXCEPT ![g] = Append(@, [kind |-> k, seen |-> view[g]])]
  /\ UNCHANGED <<turn, ready, rdyTurn, human, connected, toGuest, view, advancedWith>>

HostProcess(g) ==
  /\ toHost[g] # <<>>
  /\ LET m == Head(toHost[g]) IN
       \/ /\ human[g] /\ (~TagTurns \/ m.seen = turn)
          /\ Advance([ready EXCEPT ![g] = (m.kind = "ready")], [rdyTurn EXCEPT ![g] = m.seen], human)
       \/ /\ ~(human[g] /\ (~TagTurns \/ m.seen = turn))        \* dropped player or stale message: ignore
          /\ UNCHANGED <<turn, ready, rdyTurn, advancedWith, toGuest>>
  /\ toHost' = [toHost EXCEPT ![g] = Tail(@)]
  /\ UNCHANGED <<human, connected, view>>

GuestRecv(g) ==
  /\ toGuest[g] # <<>>
  /\ view' = [view EXCEPT ![g] = Head(toGuest[g])]
  /\ toGuest' = [toGuest EXCEPT ![g] = Tail(@)]
  /\ UNCHANGED <<turn, ready, rdyTurn, human, connected, toHost, advancedWith>>

Disconnect(g) ==
  /\ connected[g]
  /\ connected' = [connected EXCEPT ![g] = FALSE]
  /\ toGuest' = [toGuest EXCEPT ![g] = <<>>]
  /\ UNCHANGED <<turn, ready, rdyTurn, human, toHost, view, advancedWith>>

\* host notices the dead channel (or the host presses "drop") and gives the empire to the AI
HostNoticeClose(g) ==
  /\ ~connected[g] /\ human[g]
  /\ LET h == [human EXCEPT ![g] = FALSE] IN
       /\ Advance([ready EXCEPT ![g] = FALSE], rdyTurn, h)
       /\ human' = h
  /\ UNCHANGED <<connected, toHost, view>>

Next ==
  \/ HostSetReady(TRUE) \/ HostSetReady(FALSE)
  \/ \E g \in Guests : GuestSend(g, "ready") \/ GuestSend(g, "unready") \/ HostProcess(g)
                       \/ GuestRecv(g) \/ Disconnect(g) \/ HostNoticeClose(g)

Fairness ==
  /\ \A g \in Guests : WF_vars(HostProcess(g)) /\ WF_vars(GuestRecv(g)) /\ WF_vars(HostNoticeClose(g))

Spec == Init /\ [][Next]_vars /\ Fairness

(* ------------------------------ properties ------------------------------ *)

\* The turn only ever advanced with every living human ready.
AdvanceNeededAll == \A p \in Players : advancedWith[p]

\* Nobody is counted ready for a turn they had not yet seen. This is the "stale ready" hazard.
ReadyIsFresh == \A p \in Players : (human[p] /\ ready[p]) => rdyTurn[p] = turn

\* Nothing waits forever in an all-ready state.
NoStuckAllReady == turn < MaxTurn => ~AllReady(ready, human)

\* A dropped player is never counted as ready.
NoZombieReady == \A p \in Players : ~human[p] => ~ready[p]

\* A connected guest eventually sees the current turn (or leaves).
GuestsCatchUp == \A g \in Guests : (connected[g] /\ human[g]) ~> (view[g] = turn \/ ~connected[g])
=============================================================================
