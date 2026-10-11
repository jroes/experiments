---- MODULE TurnSync_TTrace_1791754636 ----
EXTENDS TurnSync, Sequences, TLCExt, Toolbox, TurnSync_TEConstants, Naturals, TLC

_expression ==
    LET TurnSync_TEExpression == INSTANCE TurnSync_TEExpression
    IN TurnSync_TEExpression!expression
----

_trace ==
    LET TurnSync_TETrace == INSTANCE TurnSync_TETrace
    IN TurnSync_TETrace!trace
----

_inv ==
    ~(
        TLCGet("level") = Len(_TETrace)
        /\
        connected = ((g1 :> TRUE @@ g2 :> TRUE))
        /\
        toGuest = ((g1 :> <<2>> @@ g2 :> <<2>>))
        /\
        view = ((g1 :> 1 @@ g2 :> 1))
        /\
        advancedWith = ((g1 :> TRUE @@ g2 :> TRUE @@ h :> TRUE))
        /\
        toHost = ((g1 :> <<>> @@ g2 :> <<>>))
        /\
        ready = ((g1 :> TRUE @@ g2 :> FALSE @@ h :> FALSE))
        /\
        rdyTurn = ((g1 :> 1 @@ g2 :> 2 @@ h :> 2))
        /\
        turn = (2)
        /\
        human = ((g1 :> TRUE @@ g2 :> TRUE @@ h :> TRUE))
    )
----

_init ==
    /\ advancedWith = _TETrace[1].advancedWith
    /\ ready = _TETrace[1].ready
    /\ view = _TETrace[1].view
    /\ human = _TETrace[1].human
    /\ toGuest = _TETrace[1].toGuest
    /\ rdyTurn = _TETrace[1].rdyTurn
    /\ toHost = _TETrace[1].toHost
    /\ turn = _TETrace[1].turn
    /\ connected = _TETrace[1].connected
----

_next ==
    /\ \E i,j \in DOMAIN _TETrace:
        /\ \/ /\ j = i + 1
              /\ i = TLCGet("level")
        /\ advancedWith  = _TETrace[i].advancedWith
        /\ advancedWith' = _TETrace[j].advancedWith
        /\ ready  = _TETrace[i].ready
        /\ ready' = _TETrace[j].ready
        /\ view  = _TETrace[i].view
        /\ view' = _TETrace[j].view
        /\ human  = _TETrace[i].human
        /\ human' = _TETrace[j].human
        /\ toGuest  = _TETrace[i].toGuest
        /\ toGuest' = _TETrace[j].toGuest
        /\ rdyTurn  = _TETrace[i].rdyTurn
        /\ rdyTurn' = _TETrace[j].rdyTurn
        /\ toHost  = _TETrace[i].toHost
        /\ toHost' = _TETrace[j].toHost
        /\ turn  = _TETrace[i].turn
        /\ turn' = _TETrace[j].turn
        /\ connected  = _TETrace[i].connected
        /\ connected' = _TETrace[j].connected

\* Uncomment the ASSUME below to write the states of the error trace
\* to the given file in Json format. Note that you can pass any tuple
\* to `JsonSerialize`. For example, a sub-sequence of _TETrace.
    \* ASSUME
    \*     LET J == INSTANCE Json
    \*         IN J!JsonSerialize("TurnSync_TTrace_1791754636.json", _TETrace)

=============================================================================

 Note that you can extract this module `TurnSync_TEExpression`
  to a dedicated file to reuse `expression` (the module in the 
  dedicated `TurnSync_TEExpression.tla` file takes precedence 
  over the module `TurnSync_TEExpression` below).

---- MODULE TurnSync_TEExpression ----
EXTENDS TurnSync, Sequences, TLCExt, Toolbox, TurnSync_TEConstants, Naturals, TLC

expression == 
    [
        \* To hide variables of the `TurnSync` spec from the error trace,
        \* remove the variables below.  The trace will be written in the order
        \* of the fields of this record.
        advancedWith |-> advancedWith
        ,ready |-> ready
        ,view |-> view
        ,human |-> human
        ,toGuest |-> toGuest
        ,rdyTurn |-> rdyTurn
        ,toHost |-> toHost
        ,turn |-> turn
        ,connected |-> connected
        
        \* Put additional constant-, state-, and action-level expressions here:
        \* ,_stateNumber |-> _TEPosition
        \* ,_advancedWithUnchanged |-> advancedWith = advancedWith'
        
        \* Format the `advancedWith` variable as Json value.
        \* ,_advancedWithJson |->
        \*     LET J == INSTANCE Json
        \*     IN J!ToJson(advancedWith)
        
        \* Lastly, you may build expressions over arbitrary sets of states by
        \* leveraging the _TETrace operator.  For example, this is how to
        \* count the number of times a spec variable changed up to the current
        \* state in the trace.
        \* ,_advancedWithModCount |->
        \*     LET F[s \in DOMAIN _TETrace] ==
        \*         IF s = 1 THEN 0
        \*         ELSE IF _TETrace[s].advancedWith # _TETrace[s-1].advancedWith
        \*             THEN 1 + F[s-1] ELSE F[s-1]
        \*     IN F[_TEPosition - 1]
    ]

=============================================================================



Parsing and semantic processing can take forever if the trace below is long.
 In this case, it is advised to uncomment the module below to deserialize the
 trace from a generated binary file.

\*
\*---- MODULE TurnSync_TETrace ----
\*EXTENDS TurnSync, IOUtils, TurnSync_TEConstants, TLC
\*
\*trace == IODeserialize("TurnSync_TTrace_1791754636.bin", TRUE)
\*
\*=============================================================================
\*

---- MODULE TurnSync_TETrace ----
EXTENDS TurnSync, TurnSync_TEConstants, TLC

trace == 
    <<
    ([connected |-> (g1 :> TRUE @@ g2 :> TRUE),toGuest |-> (g1 :> <<>> @@ g2 :> <<>>),view |-> (g1 :> 1 @@ g2 :> 1),advancedWith |-> (g1 :> TRUE @@ g2 :> TRUE @@ h :> TRUE),toHost |-> (g1 :> <<>> @@ g2 :> <<>>),ready |-> (g1 :> FALSE @@ g2 :> FALSE @@ h :> FALSE),rdyTurn |-> (g1 :> 1 @@ g2 :> 1 @@ h :> 1),turn |-> 1,human |-> (g1 :> TRUE @@ g2 :> TRUE @@ h :> TRUE)]),
    ([connected |-> (g1 :> TRUE @@ g2 :> TRUE),toGuest |-> (g1 :> <<>> @@ g2 :> <<>>),view |-> (g1 :> 1 @@ g2 :> 1),advancedWith |-> (g1 :> TRUE @@ g2 :> TRUE @@ h :> TRUE),toHost |-> (g1 :> <<>> @@ g2 :> <<>>),ready |-> (g1 :> FALSE @@ g2 :> FALSE @@ h :> TRUE),rdyTurn |-> (g1 :> 1 @@ g2 :> 1 @@ h :> 1),turn |-> 1,human |-> (g1 :> TRUE @@ g2 :> TRUE @@ h :> TRUE)]),
    ([connected |-> (g1 :> TRUE @@ g2 :> TRUE),toGuest |-> (g1 :> <<>> @@ g2 :> <<>>),view |-> (g1 :> 1 @@ g2 :> 1),advancedWith |-> (g1 :> TRUE @@ g2 :> TRUE @@ h :> TRUE),toHost |-> (g1 :> <<[kind |-> "ready", seen |-> 1]>> @@ g2 :> <<>>),ready |-> (g1 :> FALSE @@ g2 :> FALSE @@ h :> TRUE),rdyTurn |-> (g1 :> 1 @@ g2 :> 1 @@ h :> 1),turn |-> 1,human |-> (g1 :> TRUE @@ g2 :> TRUE @@ h :> TRUE)]),
    ([connected |-> (g1 :> TRUE @@ g2 :> TRUE),toGuest |-> (g1 :> <<>> @@ g2 :> <<>>),view |-> (g1 :> 1 @@ g2 :> 1),advancedWith |-> (g1 :> TRUE @@ g2 :> TRUE @@ h :> TRUE),toHost |-> (g1 :> <<[kind |-> "ready", seen |-> 1], [kind |-> "ready", seen |-> 1]>> @@ g2 :> <<>>),ready |-> (g1 :> FALSE @@ g2 :> FALSE @@ h :> TRUE),rdyTurn |-> (g1 :> 1 @@ g2 :> 1 @@ h :> 1),turn |-> 1,human |-> (g1 :> TRUE @@ g2 :> TRUE @@ h :> TRUE)]),
    ([connected |-> (g1 :> TRUE @@ g2 :> TRUE),toGuest |-> (g1 :> <<>> @@ g2 :> <<>>),view |-> (g1 :> 1 @@ g2 :> 1),advancedWith |-> (g1 :> TRUE @@ g2 :> TRUE @@ h :> TRUE),toHost |-> (g1 :> <<[kind |-> "ready", seen |-> 1]>> @@ g2 :> <<>>),ready |-> (g1 :> TRUE @@ g2 :> FALSE @@ h :> TRUE),rdyTurn |-> (g1 :> 1 @@ g2 :> 1 @@ h :> 1),turn |-> 1,human |-> (g1 :> TRUE @@ g2 :> TRUE @@ h :> TRUE)]),
    ([connected |-> (g1 :> TRUE @@ g2 :> TRUE),toGuest |-> (g1 :> <<>> @@ g2 :> <<>>),view |-> (g1 :> 1 @@ g2 :> 1),advancedWith |-> (g1 :> TRUE @@ g2 :> TRUE @@ h :> TRUE),toHost |-> (g1 :> <<[kind |-> "ready", seen |-> 1]>> @@ g2 :> <<[kind |-> "ready", seen |-> 1]>>),ready |-> (g1 :> TRUE @@ g2 :> FALSE @@ h :> TRUE),rdyTurn |-> (g1 :> 1 @@ g2 :> 1 @@ h :> 1),turn |-> 1,human |-> (g1 :> TRUE @@ g2 :> TRUE @@ h :> TRUE)]),
    ([connected |-> (g1 :> TRUE @@ g2 :> TRUE),toGuest |-> (g1 :> <<2>> @@ g2 :> <<2>>),view |-> (g1 :> 1 @@ g2 :> 1),advancedWith |-> (g1 :> TRUE @@ g2 :> TRUE @@ h :> TRUE),toHost |-> (g1 :> <<[kind |-> "ready", seen |-> 1]>> @@ g2 :> <<>>),ready |-> (g1 :> FALSE @@ g2 :> FALSE @@ h :> FALSE),rdyTurn |-> (g1 :> 2 @@ g2 :> 2 @@ h :> 2),turn |-> 2,human |-> (g1 :> TRUE @@ g2 :> TRUE @@ h :> TRUE)]),
    ([connected |-> (g1 :> TRUE @@ g2 :> TRUE),toGuest |-> (g1 :> <<2>> @@ g2 :> <<2>>),view |-> (g1 :> 1 @@ g2 :> 1),advancedWith |-> (g1 :> TRUE @@ g2 :> TRUE @@ h :> TRUE),toHost |-> (g1 :> <<>> @@ g2 :> <<>>),ready |-> (g1 :> TRUE @@ g2 :> FALSE @@ h :> FALSE),rdyTurn |-> (g1 :> 1 @@ g2 :> 2 @@ h :> 2),turn |-> 2,human |-> (g1 :> TRUE @@ g2 :> TRUE @@ h :> TRUE)])
    >>
----


=============================================================================

---- MODULE TurnSync_TEConstants ----
EXTENDS TurnSync

CONSTANTS g1, g2, h

=============================================================================

---- CONFIG TurnSync_TTrace_1791754636 ----
CONSTANTS
    Guests = { g1 , g2 }
    Host = h
    MaxTurn = 3
    MaxQ = 3
    TagTurns = FALSE
    h = h
    g1 = g1
    g2 = g2

INVARIANT
    _inv

CHECK_DEADLOCK
    \* CHECK_DEADLOCK off because of PROPERTY or INVARIANT above.
    FALSE

INIT
    _init

NEXT
    _next

CONSTANT
    _TETrace <- _trace

ALIAS
    _expression
=============================================================================
\* Generated on Sun Oct 11 21:37:17 UTC 2026