# Ride check-in

_Last updated: 2026-10-01_

At the Start, authorized staff record the rider's decision before flag-off; pit-stop staff scan arrivals at their assigned stage, and Hotel Staff may record the Finish. Scans record their time and resolve a rider from the QR code as described in [ID codes](id-codes.md). Users may choose regular check-in, Not Riding while the ride is OPEN, or Quit Riding after it is STARTED, subject to permissions. Hotel Staff cannot record Quit Riding. An authorized user may enter a rider ID manually when the normal scan cannot be used.

Only riders registered or active for the tour are eligible. Online submissions must be checked against current central rider and ride status; offline pre-validation uses cached status and is rechecked at sync. Not Riding and Quit Riding prevent subsequent check-ins. If a Start-stage decision conflicts with an existing regular, Not Riding or Float entry, offer Override or Cancel; overriding cancels the previous entry before recording the replacement. This override requires connectivity.

The Check-In Log labels entries whose method is `SELF_SERVICE` as **Self**. **Only staff can cancel Quit Riding. Before confirming, staff must confirm the rider is safe and fit to resume.** Other staff cancel and redo flows are unchanged. A check-in cancellation must be explicit and permission-gated, and the log must reflect the resulting status. See [float](float.md) and [offline](offline.md).
