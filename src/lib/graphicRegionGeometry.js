export function sourceGraphicBboxToEditor(pageWidth, bbox, mirrorEnabled) {
  if (!Array.isArray(bbox) || bbox.length !== 4) {
    return null;
  }
  if (!mirrorEnabled) {
    return bbox.map((value) => Number(value));
  }
  return [
    Number(pageWidth) - Number(bbox[2]),
    Number(bbox[1]),
    Number(pageWidth) - Number(bbox[0]),
    Number(bbox[3]),
  ];
}

export function editorGraphicBboxToSource(pageWidth, bbox, mirrorEnabled) {
  if (!Array.isArray(bbox) || bbox.length !== 4) {
    return null;
  }
  if (!mirrorEnabled) {
    return bbox.map((value) => Number(value));
  }
  return [
    Number(pageWidth) - Number(bbox[2]),
    Number(bbox[1]),
    Number(pageWidth) - Number(bbox[0]),
    Number(bbox[3]),
  ];
}
