function stringValue(value) {
  return String(value ?? '').trim();
}

export function categoryId(row) {
  return stringValue(row?.type_id ?? row?.id ?? row?.typeId);
}

export function categoryName(row) {
  return stringValue(row?.type_name ?? row?.name ?? row?.typeName);
}

export function parentIdOf(row) {
  return stringValue(row?.type_pid ?? row?.parent_id ?? row?.pid ?? row?.parentId);
}

function cloneNativeClass(row) {
  return { ...row };
}

function hasParentStructure(classes) {
  return classes.some((row) => {
    const parentId = parentIdOf(row);
    return parentId && parentId !== '0';
  });
}

function normalizedProbe(probe) {
  return {
    ok: Boolean(probe?.ok),
    count: Number(probe?.count || 0),
    total: Number(probe?.total || 0),
    status: Number(probe?.status || 0),
    error: stringValue(probe?.error),
  };
}

function nativeListingMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (['class', 'classes', 'list'].includes(key)) continue;
    if (key === 'data' && entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const nested = { ...entry };
      delete nested.class;
      delete nested.classes;
      delete nested.list;
      result[key] = nested;
      continue;
    }
    result[key] = entry;
  }
  return result;
}

export function buildCategoryManifest(classes, probeById = new Map(), checkedAt = new Date().toISOString(), upstreamListing = null) {
  const nativeClasses = Array.isArray(classes)
    ? classes.filter((row) => categoryId(row) && categoryName(row))
    : [];
  const idsWithChildren = new Set(nativeClasses
    .map(parentIdOf)
    .filter((value) => value && value !== '0'));
  const structured = hasParentStructure(nativeClasses);
  const rows = nativeClasses.map((row, index) => {
    const id = categoryId(row);
    const probe = normalizedProbe(probeById.get(id));
    const isParent = structured && idsWithChildren.has(id);
    const hasData = probe.ok && probe.count > 0;
    const visible = !isParent && hasData;
    return {
      id,
      name: categoryName(row),
      parentId: parentIdOf(row),
      index,
      nativeClass: cloneNativeClass(row),
      probe,
      visible,
      hiddenReason: visible ? '' : isParent ? 'STRUCTURAL_PARENT' : 'EMPTY_OR_UNVERIFIED_CATEGORY',
    };
  });
  return {
    schemaVersion: 'native-category-1',
    checkedAt,
    sourceAgnostic: true,
    structured,
    nativeListing: nativeListingMetadata(upstreamListing),
    visibleCount: rows.filter((row) => row.visible).length,
    hiddenCount: rows.filter((row) => !row.visible).length,
    rows,
  };
}

export function chooseCategoryManifest(current, previous = null) {
  if (current?.visibleCount > 0) return current;
  if (previous?.visibleCount > 0) return { ...previous, fallbackReason: 'CURRENT_MANIFEST_EMPTY' };
  return current;
}

export function visibleClassesFromManifest(manifest) {
  return (manifest?.rows || [])
    .filter((row) => row.visible)
    .sort((left, right) => left.index - right.index)
    .map((row) => ({ ...row.nativeClass }));
}
