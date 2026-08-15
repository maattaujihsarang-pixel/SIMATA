function normalizeString(value) {
	return value === undefined || value === null
		? ""
		: String(value).trim();
}

function getSheetHeaders(sheet) {
	const lastColumn = sheet.getLastColumn();

	if (lastColumn === 0) {
		return [];
	}

	const values = sheet.getRange(1, 1, 1, lastColumn).getValues();

	return values[0].map(function(value) {
		return normalizeString(value);
	});
}

function getHeaderMap(headers) {
	const map = {};

	headers.forEach(function(header, index) {
		map[header] = index;
	});

	return map;
}
