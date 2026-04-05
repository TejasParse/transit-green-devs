const { getProfilesForDemo } = require('../db/profile-queries');

async function getProfiles(req, res, next) {
  try {
    const profiles = await getProfilesForDemo();
    res.json(profiles);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getProfiles,
};
