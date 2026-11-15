const isRiyadhBranch = branch => !branch.city || branch.city === 'ryad';

export function reportBranchesForCity(branches, city) {
    if (city === 'all') return branches;
    return branches.filter(branch => city === 'ryad' ? isRiyadhBranch(branch) : branch.city === city);
}

export function sortReportBranches(branches) {
    return [...branches].sort((left, right) => {
        const cityOrder = Number(!isRiyadhBranch(left)) - Number(!isRiyadhBranch(right));
        return cityOrder || String(left.name || left.id).localeCompare(String(right.name || right.id), 'ar') ||
            left.id.localeCompare(right.id);
    });
}
