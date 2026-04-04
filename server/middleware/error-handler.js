function errorHandler(error, _req, res, _next) {
  console.error(error);

  if (error instanceof Error) {
    res.status(400).send(error.message);
    return;
  }

  res.status(500).send('Unexpected server error.');
}

module.exports = {
  errorHandler,
};
