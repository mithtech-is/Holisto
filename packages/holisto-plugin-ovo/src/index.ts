/**
 * Plugin entry.
 *
 * Medusa auto-discovers the plugin's modules (`src/modules`), API routes
 * (`src/api`), admin extensions (`src/admin`), scheduled jobs
 * (`src/jobs`), subscribers (`src/subscribers`), and workflows
 * (`src/workflows`) when the package is listed in the host app's
 * `plugins` array. There is nothing to export from the entry itself.
 *
 * The OVO module still needs to be registered in the host's `modules`
 * array so its service is resolvable by the API routes and jobs — see
 * the README "Installation" section.
 */
export default {}
