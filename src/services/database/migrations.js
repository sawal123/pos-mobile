import { MIGRATIONS } from './schema'

/**
 * Applies any pending schema migrations so the database reaches targetVersion.
 *
 * Schema versioning is owned by the database adapter/migration layer, NOT by
 * the persistence service. This function must never silently downgrade and must
 * never re-run a migration destructively.
 *
 * Fresh installs (version 0) start with the base schema which is version 1, so
 * we only bump the bookkeeping version to 1 before applying later migrations.
 *
 * @param {object} dbLike Interface with `getVersion`, `setVersion` and `execute`.
 * @param {number} targetVersion The version the schema should end at.
 */
export async function applyMigrations(dbLike, targetVersion) {
  let currentVersion = await dbLike.getVersion()

  if (currentVersion === 0) {
    await dbLike.setVersion(1)
    currentVersion = 1
  }

  if (currentVersion > targetVersion) {
    throw new Error(
      `Unsupported future database schema version ${currentVersion}. Expected at most ${targetVersion}.`,
    )
  }

  if (currentVersion === targetVersion) {
    return {
      from: currentVersion,
      to: targetVersion,
      applied: [],
    }
  }

  const applied = []

  for (let version = currentVersion + 1; version <= targetVersion; version += 1) {
    const migration = MIGRATIONS[version]

    if (!migration) {
      throw new Error(`Missing migration for database schema version ${version}.`)
    }

    await dbLike.execute(migration)
    await dbLike.setVersion(version)
    applied.push(version)
  }

  return {
    from: currentVersion,
    to: targetVersion,
    applied,
  }
}
