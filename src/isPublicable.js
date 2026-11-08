import npmName, { InvalidNameError } from 'npm-name';

/**
 * Checks whether a package name is available to be published on NPM.
 *
 * @param {string} packageName - The package name to check.
 * @returns {Promise<boolean>} - True if available to publish, false if taken or invalid.
 */
export async function checkIfItsPublishable(packageName) {
  try {
    const isAvailable = await npmName(packageName);
    return Boolean(isAvailable);
  } catch (error) {
    if (error instanceof InvalidNameError || error.name === 'InvalidNameError') {
      console.warn(`Package "${packageName}" is not a valid NPM package name: ${error.message.split('\n')[0]}`);
      return false;
    }

    console.error(`Error checking npm availability for "${packageName}":`, error.message);
    return false;
  }
}
