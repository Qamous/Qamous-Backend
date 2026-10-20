export const GLOSS_DISPLAY_VERSION: string;
export interface FormattedDefinition {
  text: string;
  changed: boolean;
  changes: string[];
  sourceMarkers: string[];
}
export function formatImportedDefinition(originalText:string,sourceIds?:string[],english?:boolean):FormattedDefinition;
export function formatImportedExample(originalText:string,sourceId:string):FormattedDefinition;
