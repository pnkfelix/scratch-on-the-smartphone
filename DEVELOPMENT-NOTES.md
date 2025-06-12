## NOTES FOR CLAUDE

* If you have concrete suggestions for changes, present them as diffs. Do not attempt to present the whole file rewritten, as that wastes tokens.
* If you make an array expression whose elements are written one-per-line, then prefer to include a trailing comma after the last element.
* **IMPORTANT**: Maintain the conversation transcript in `CLAUDE-PROMPT-TRANSCRIPT.md` by adding non-trivial prompts from each Claude Code session. This provides valuable development history and context for future work.

## TODO LIST

     [ ] WHen storyteller clicks a message, make that be the current "Send to" if one isn't already set.
     [ ] Add name of current msg target in the "Type your message..." box, i.e. "Type your messager to Neha."
     [ ] Maybe add message drafting for the storyteller, so that they can start a message to someone, then click someone else, start their message, and then come back
     [X] Add role assignment tracking for the storyteller
     [X] Add selection of roles from the script
     [X] Add random assignment of roles to the players
     [ ] The list of all players and the send to combo box are redundant. Remove one of them after getting more UX on phone
     [ ] The preset collection of template options is being applied universally. Its a nice demo of a concept but it isn't buying anything yet. I think once we have role assignment then it might make more sense to have those things get filled in.
     [X] "Reminder tokens" aka per-player notes. Potentially have the available set of reminders be informed by the characters on the script, maybe even solely the ones in play.
     [ ] Add ability to add/remove players.
     [X] More specifically on the above: there's some issue where If I try to adjust the number of players for a *new game* in a pre-existing room, the overall system seems to grab (maybe old?) messages and allows them to override my more recent choices. There might be a need for some kind of game identification or timestamping to deal with this.
     [X] Ghost vote tracking for players
     [X] Player death tracking with visual indicators
     [X] Night action templates system
     [X] Day/night phase transitions
     [X] Storyteller workflow phases (distribute roles → minion/demon info → night actions)
     [X] Script viewer functionality
     [X] Game state reconstruction on reconnect
     [X] Message ordering and timestamps
     [X] Role distribution validation (duplicates, believesToBe roles)
     [X] Night order support for role selection
     [ ] Performance optimization and code organization (partially addressed via modular file structure)


