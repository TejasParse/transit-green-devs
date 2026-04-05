const { readPositiveInteger, readRequiredString } = require('./trip-validator');

function readNonNegativeInteger(value, fieldName) {
  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue < 0) {
    throw new Error(`${fieldName} must be a non-negative integer.`);
  }

  return parsedValue;
}

function validatePlantTreePayload(body) {
  return {
    userId: readPositiveInteger(body?.userId, 'userId'),
    treeTypeId: readRequiredString(body?.treeTypeId, 'treeTypeId', 80),
    gridX: readNonNegativeInteger(body?.gridX, 'gridX'),
    gridY: readNonNegativeInteger(body?.gridY, 'gridY'),
  };
}

module.exports = {
  validatePlantTreePayload,
};
