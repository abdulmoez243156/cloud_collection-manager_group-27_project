// Runs the API on your PC: npm run dev  ->  http://localhost:3000
const app = require('./app');

const PORT = process.env.PORT || 3000;

// Start on direct execution and allow imports for tests.
// Vercel imports the exported app and runs it as one serverless function.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
