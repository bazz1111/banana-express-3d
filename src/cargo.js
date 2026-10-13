// The rack has a display capacity; collected bananas and score have no quota.
export function cargoVisibleCounts(globalIndices,bananas){
  const hands=Math.min(20,Math.max(0,Math.floor(bananas/5)));
  return globalIndices.map(indices=>indices.filter(i=>i<hands).length);
}
