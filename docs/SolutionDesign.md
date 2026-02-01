This document covers the solution design aspects of the App that must be adhered to. If there is any conflict between the copilot-instructions.md and this document, it must be flagged for resolution.

This is an evolving document and hence latest info must be referred to at all times.

# Design Principles:  

- App should have a common code base to cater for Android, iOS and Web App versions.  
  * Any except to have flavour specific code when common code is feasible must be flagged for review before proceeding with the development.
- Any direct access to AWS Resource access from Mobile App or Web client must not be permitted. Such access must always be through Amplify backend.
- 
