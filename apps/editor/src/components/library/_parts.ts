/**
 * Reading a list out of a scalar.
 *
 * The document holds `string | number | boolean` and nothing else, because a prop has to
 * survive a clone by history, a write by the save format and a trip to a collaborator. So a
 * component that is genuinely about a list of things, a set of tabs or the options of a
 * select, takes that list as one comma separated string and splits it here.
 *
 * This is a real limitation and not a preference. The honest fix is for the document to hold
 * arrays, which is a schema version and a change to the panel, the printer and the reader, so
 * it is written down in TASKS.md rather than worked around quietly. Until then one function
 * does the splitting for every component, so they cannot disagree about what a list is.
 */
export function parts(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}
