/**
 * Wraps an async express handler so a rejected promise is forwarded to the
 * error middleware instead of crashing the process.
 */
const asyncHandler = (requestHandler) => (req, res, next) => {
  Promise.resolve(requestHandler(req, res, next)).catch(next);
};

export { asyncHandler };
export default asyncHandler;
