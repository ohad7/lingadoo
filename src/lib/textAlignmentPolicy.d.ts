export function inferTextDirection(text?: string): 'rtl' | 'ltr';
export function resolveEffectiveAlignment(options?: {
  alignment?: string;
  text?: string;
  textTightness?: string;
  alignmentEdited?: boolean;
}): 'left' | 'center' | 'right' | 'justify';
export function resolveMirroredAlignment(options?: {
  sourceAlignment?: string;
  translatedText?: string;
  textTightness?: string;
  mirrorEnabled?: boolean;
  alignmentEdited?: boolean;
}): 'left' | 'center' | 'right' | 'justify';
