import axios from 'axios'

export async function requestBuiltInCommand(serverUrl, payload) {
  const response = await axios.post(`${serverUrl}/api/v1/command`, payload)

  return response.data
}
