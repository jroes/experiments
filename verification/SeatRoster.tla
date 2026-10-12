---------------------------- MODULE SeatRoster -----------------------------
(*
  Who plays which seat, and what the host is shown when handing out links.

  The bug this was written for: the host chose "give seat 3 to the AI", and the invite list still offered a link for seat 3.
  A friend using it would have joined an empire the AI runs.

  A seat is "human" (a person plays it), "ai" (the AI plays it) or "out" (wiped out). Handing a seat to the AI is two steps,
  because it goes through the shared board like every other order: the host posts a "take over" entry (the seat is `pending`),
  and the seat only becomes "ai" when the turn plays. Between the two, the game state still says "human". A list built from the
  game state alone is wrong in that window, so the list has to look at the board too.

  OfferMode picks how the list of links is built:
    "all"  every seat but the host's   (what the first version did)
    "base" seats the game state calls human
    "full" seats that are human and have no pending take-over   (the fix)
  GuardJoin: whether joining checks the seat the same way.

  Checked:
    NoLinkToAI       while the host looks at the links, none is for an AI seat or one about to become AI
    NoJoinOfAI       nobody joins a seat the AI plays or is about to play
    AIIsFinal        a seat the AI plays never becomes a person's again
    OutIsFinal       a wiped-out empire never comes back
    JoinedAreTold    a person who joined and then lost their seat to the AI is eventually told (their page shows it)
*)
EXTENDS Naturals, FiniteSets

CONSTANTS Seats, OfferMode, GuardJoin
Host == 1
Roles == {"human", "ai", "out"}

VARIABLES role, pending, dialog, shown, joined, told
vars == <<role, pending, dialog, shown, joined, told>>

Offer(r, p) ==
  CASE OfferMode = "all"  -> Seats \ {Host}
    [] OfferMode = "base" -> {s \in Seats \ {Host} : r[s] = "human"}
    [] OfferMode = "full" -> {s \in Seats \ {Host} : r[s] = "human" /\ ~p[s]}

CanJoin(s) == IF GuardJoin THEN role[s] # "ai" /\ ~pending[s] ELSE TRUE

TypeOK ==
  /\ role \in [Seats -> Roles]
  /\ pending \in [Seats -> BOOLEAN]
  /\ dialog \in BOOLEAN
  /\ shown \subseteq Seats /\ joined \subseteq Seats /\ told \subseteq Seats

Init ==
  /\ role = [s \in Seats |-> "human"]
  /\ pending = [s \in Seats |-> FALSE]
  /\ dialog = FALSE /\ shown = {} /\ joined = {} /\ told = {}

\* the host chooses "AI" for someone. The dialog is modal, so this cannot happen while it is open.
HostTakesOver(s) ==
  /\ ~dialog /\ s # Host /\ role[s] = "human" /\ ~pending[s]
  /\ pending' = [pending EXCEPT ![s] = TRUE]
  /\ UNCHANGED <<role, dialog, shown, joined, told>>

\* the turn plays: every pending take-over becomes final. Someone may also be wiped out.
PlayTurn ==
  /\ role' = [s \in Seats |-> IF pending[s] THEN "ai" ELSE role[s]]
  /\ pending' = [s \in Seats |-> FALSE]
  /\ UNCHANGED <<dialog, shown, joined, told>>

\* A take-over entry is applied at the start of the turn play, before fights, so a seat with one pending cannot be wiped out first.
\* (The first version of this model allowed it, and TLC showed a wiped-out empire becoming "ai": a take-over aimed at a dead seat.
\* In the code, advanceWith only applies entries for living people, and hostSkip refuses a seat that is not alive.)
WipeOut(s) ==
  /\ role[s] = "human" /\ ~pending[s]
  /\ role' = [role EXCEPT ![s] = "out"]
  /\ UNCHANGED <<pending, dialog, shown, joined, told>>

OpenLinks ==
  /\ ~dialog
  /\ dialog' = TRUE /\ shown' = Offer(role, pending)
  /\ UNCHANGED <<role, pending, joined, told>>

CloseLinks ==
  /\ dialog
  /\ dialog' = FALSE /\ shown' = {}
  /\ UNCHANGED <<role, pending, joined, told>>

\* a friend opens a link. Without the guard, the link works for whatever seat it names.
Join(s) ==
  /\ s \notin joined /\ s # Host /\ CanJoin(s)
  /\ joined' = joined \cup {s}
  /\ UNCHANGED <<role, pending, dialog, shown, told>>

\* a joined person's page notices the seat is going to the AI and says so
Notice(s) ==
  /\ s \in joined /\ s \notin told /\ (role[s] = "ai" \/ pending[s])
  /\ told' = told \cup {s}
  /\ UNCHANGED <<role, pending, dialog, shown, joined>>

Next ==
  \/ \E s \in Seats : HostTakesOver(s) \/ WipeOut(s) \/ Join(s) \/ Notice(s)
  \/ PlayTurn \/ OpenLinks \/ CloseLinks

Spec == Init /\ [][Next]_vars /\ WF_vars(\E s \in Seats : Notice(s))

NoLinkToAI == dialog => \A s \in shown : role[s] # "ai" /\ ~pending[s]

NoJoinOfAI == [][\A s \in joined' \ joined : role[s] # "ai" /\ ~pending[s]]_vars

AIIsFinal  == [][\A s \in Seats : role[s] = "ai"  => role'[s] = "ai"]_vars
OutIsFinal == [][\A s \in Seats : role[s] = "out" => role'[s] = "out"]_vars

JoinedAreTold == \A s \in Seats : (s \in joined /\ (role[s] = "ai" \/ pending[s])) ~> (s \in told)
=============================================================================
