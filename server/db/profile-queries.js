const { pool } = require('./pool');

function mapProfileRow(row) {
  return {
    userId: row.id,
    displayName: row.user_name,
    email: row.email,
    age: row.age,
    gender: row.gender,
    licenceNo: row.licence_no,
    authProvider: row.auth_provider,
    authSubject: row.auth_subject,
    pictureUrl: row.picture_url,
    createdAt: row.created_at,
  };
}

function getSuggestedDisplayName(name, email) {
  if (typeof name === 'string' && name.trim()) {
    return name.trim().slice(0, 160);
  }

  if (typeof email === 'string' && email.trim()) {
    return email.trim().split('@')[0].slice(0, 160);
  }

  return 'Transit Rider';
}

async function findProfileByIdentity({ authProvider, authSubject, email }, db = pool) {
  if (authProvider && authSubject) {
    const bySubjectResult = await db.query(
      `
        SELECT *
        FROM profiles
        WHERE auth_provider = $1
          AND auth_subject = $2
        LIMIT 1
      `,
      [authProvider, authSubject]
    );

    if (bySubjectResult.rowCount > 0) {
      return bySubjectResult.rows[0];
    }
  }

  if (email) {
    const byEmailResult = await db.query(
      `
        SELECT *
        FROM profiles
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1
      `,
      [email]
    );

    if (byEmailResult.rowCount > 0) {
      return byEmailResult.rows[0];
    }
  }

  return null;
}

async function resolveProfileSession(payload) {
  const existingProfile = await findProfileByIdentity(payload);

  if (existingProfile) {
    const result = await pool.query(
      `
        UPDATE profiles
        SET
          email = $2,
          auth_provider = COALESCE($3, auth_provider),
          auth_subject = COALESCE($4, auth_subject),
          picture_url = COALESCE($5, picture_url)
        WHERE id = $1
        RETURNING *
      `,
      [
        existingProfile.id,
        payload.email,
        payload.authProvider,
        payload.authSubject,
        payload.pictureUrl,
      ]
    );

    return {
      needsProfileCompletion: false,
      profile: mapProfileRow(result.rows[0]),
    };
  }

  if (payload.age == null || !payload.gender) {
    return {
      needsProfileCompletion: true,
      profile: null,
      missingFields: [
        ...(payload.age == null ? ['age'] : []),
        ...(!payload.gender ? ['gender'] : []),
      ],
      suggestedDisplayName: getSuggestedDisplayName(payload.displayName, payload.email),
    };
  }

  const result = await pool.query(
    `
      INSERT INTO profiles (
        user_name,
        car_id,
        email,
        age,
        gender,
        licence_no,
        auth_provider,
        auth_subject,
        picture_url
      )
      VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `,
    [
      getSuggestedDisplayName(payload.displayName, payload.email),
      payload.email,
      payload.age,
      payload.gender,
      payload.licenceNo ?? null,
      payload.authProvider,
      payload.authSubject,
      payload.pictureUrl ?? null,
    ]
  );

  return {
    needsProfileCompletion: false,
    profile: mapProfileRow(result.rows[0]),
  };
}

async function updateProfileDetails({ userId, displayName, age, gender, licenceNo }) {
  const result = await pool.query(
    `
      UPDATE profiles
      SET
        user_name = COALESCE($2, user_name),
        age = COALESCE($3, age),
        gender = COALESCE($4, gender),
        licence_no = $5
      WHERE id = $1
      RETURNING *
    `,
    [userId, displayName, age, gender, licenceNo ?? null]
  );

  if (result.rowCount === 0) {
    throw new Error(`Profile ${userId} does not exist.`);
  }

  return mapProfileRow(result.rows[0]);
}

module.exports = {
  resolveProfileSession,
  updateProfileDetails,
};
