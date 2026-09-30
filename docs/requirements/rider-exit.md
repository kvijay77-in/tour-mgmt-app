# Rider exit

_Last updated: 2026-09-29_

An authorized Administrator or Super User can record a rider leaving a tour. Show existing rider status and require confirmation before changing it. Exited riders remain visible in historical ride progress with an X indicator, while subsequent check-ins are blocked. Baggage-release operations, where applicable, must be completed by authorized staff in the events workflow. See [events design](../design/events.md).

An exit requires a baggage choice: retained by organizers or taken by the rider. Staff can cancel an exit to restore the previous rider status and active baggage state; retained baggage can be released later after confirmation, at which point further baggage scans are blocked. Exit and release require connectivity.
