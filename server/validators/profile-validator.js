const {
  readPositiveInteger,
  readRequiredString,
} = require('./trip-validator');

function readOptionalString(value, fieldName, maxLength = 160) {
  if (value == null || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string.`);
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, maxLength);
}

function validateProfileSessionPayload(body) {
  return {
    authProvider: readRequiredString(body?.authProvider, 'authProvider', 40),
    authSubject: readRequiredString(body?.authSubject, 'authSubject', 255),
    email: readRequiredString(body?.email, 'email', 255).toLowerCase(),
    displayName: readOptionalString(body?.displayName, 'displayName'),
    pictureUrl: readOptionalString(body?.pictureUrl, 'pictureUrl', 1024),
    age: body?.age == null || body?.age === '' ? null : readPositiveInteger(body.age, 'age'),
    gender: readOptionalString(body?.gender, 'gender', 80),
    licenceNo: readOptionalString(body?.licenceNo, 'licenceNo', 80),
  };
}

function validateProfileUpdatePayload(body) {
  const displayName = readOptionalString(body?.displayName, 'displayName');
  const gender = readOptionalString(body?.gender, 'gender', 80);
  const licenceNo = readOptionalString(body?.licenceNo, 'licenceNo', 80);
  const age = body?.age == null || body?.age === '' ? null : readPositiveInteger(body.age, 'age');

  if (displayName == null && age == null && gender == null && licenceNo == null) {
    throw new Error('At least one profile field must be provided.');
  }

  return {
    displayName,
    age,
    gender,
    licenceNo,
  };
}

module.exports = {
  validateProfileSessionPayload,
  validateProfileUpdatePayload,
};
