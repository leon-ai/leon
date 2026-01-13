import axios from 'axios'

const HUGGING_FACE_URL = 'https://huggingface.co'
const HUGGING_FACE_MIRROR_URL = 'https://hf-mirror.com'

export class NetworkHelper {
  /**
   * Check if the current network can access Hugging Face
   * @example canAccessHuggingFace() // true
   */
  public static async canAccessHuggingFace(): Promise<boolean> {
    try {
      await axios.head(HUGGING_FACE_URL)

      return true
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      return false
    }
  }

  /**
   * Set the Hugging Face URL based on the network access
   * @param url The URL to set
   * @example setHuggingFaceURL('https://huggingface.co') // https://hf-mirror.com
   */
  public static async setHuggingFaceURL(url: string): Promise<string> {
    if (!url.includes('huggingface.co')) {
      return url
    }

    const canAccess = await NetworkHelper.canAccessHuggingFace()

    if (!canAccess) {
      return url.replace(HUGGING_FACE_URL, HUGGING_FACE_MIRROR_URL)
    }

    return url
  }
}
