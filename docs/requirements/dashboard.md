# Ride dashboard

_Last updated: 2026-10-01_

The Ride Day dashboard shows each rider in a grid labeled by rider ID, with a stage legend and colors for latest progress. By default it shows the current ride and sorts by rider ID. Stage counts include riders who progressed beyond a stage; Not Riding riders do not contribute to stage counts. Float is shown as a badge rather than a completed stage. Quit Riding and Not Riding use distinct fixed colors. An exited tour rider stays visible, marked with an X, including in historical views.

Stage filtering shows progress relative to the selected stage. Sorting groups riders by stage (or unchecked first within a selected stage) and then rider ID, with Not Riding and Quit Riding last. Zoom levels progressively reveal rider ID, name, contact details and photo when available; opening a rider card shows details and the check-in timeline. The Check-In Log tab shows recorded entries and permitted cancellation actions. Previous ride dates are read-only.

The dashboard loads roster and lightweight ride progress separately and fetches rider details on demand. Show a **Self** badge on a rider tile when its latest check-in has method `SELF_SERVICE`. The rider-card timeline does not currently include method, so it does not show this label there. The client does not own the backend dashboard API. See [dashboard design](../design/dashboard.md) and [check-in](check-in.md).

For event dashboards with registration enabled, show the registered count and mark riders whose registration state is false as **Not registered**. Show **Self** on cancelled event records and rider progress items with method `SELF_SERVICE`. The event dashboard's per-activity cells do not include method, so no Self label is available there (BC-3).
