import axios from 'axios'
import type { AxiosInstance } from 'axios'

export interface NetworkOptions {
  baseURL?: string
}

export class Network {
  private options: NetworkOptions
  private axios: AxiosInstance

  public constructor(options: NetworkOptions = {}) {
    this.options = options
    this.axios = axios.create({
      baseURL: this.options.baseURL
    })
  }

  public async get<T>(url: string): Promise<T> {
    return (await this.axios.get<T>(url)).data as T
  }
}
