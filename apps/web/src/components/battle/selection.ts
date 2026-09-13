/**
 * What a press on a model means for models selected together.
 *
 * Two sides of the press have to agree about this. The page decides what stays selected and the
 * canvas decides what the drag the same press starts will move, and the canvas reads the selection
 * as it stood before the press, since React has not rendered again in between. A press that cleared
 * the selection would therefore start a drag of models the page no longer has selected: the rings
 * go, the panel's group row goes, and the drop leaves a plan nothing on the table belongs to.
 *
 * So the rule lives here and both sides ask it.
 */

/** Is this model one of a set selected together, so that a press on it acts on all of them? */
export const inSelection = (selected: ReadonlySet<string> | undefined, modelId: string | undefined): boolean => !!modelId && !!selected?.has(modelId);

/** Would a press on this model drag the whole selection? It takes two to be a group. */
export const dragsSelection = (selected: ReadonlySet<string> | undefined, modelId: string | undefined): boolean => inSelection(selected, modelId) && (selected?.size ?? 0) >= 2;
