# Ride dashboard

_Last updated: 2026-09-29_

The Ride Day dashboard shows each rider in a grid labeled by rider ID, with a stage legend and colors for latest progress. By default it shows the current ride and sorts by rider ID. Stage counts include riders who progressed beyond a stage; Not Riding riders do not contribute to stage counts. Float is shown as a badge rather than a completed stage. Quit Riding and Not Riding use distinct fixed colors. An exited tour rider stays visible, marked with an X, including in historical views.

Stage filtering shows progress relative to the selected stage. Sorting groups riders by stage (or unchecked first within a selected stage) and then rider ID, with Not Riding and Quit Riding last. Zoom levels progressively reveal rider ID, name, contact details and photo when available; opening a rider card shows details and the check-in timeline. The Check-In Log tab shows recorded entries and permitted cancellation actions. Previous ride dates are read-only.

The dashboard loads roster and lightweight ride progress separately and fetches rider details on demand. The client does not own the backend dashboard API. See [dashboard design](../design/dashboard.md) and [check-in](check-in.md).
