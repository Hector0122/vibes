// Jest stand-in for expo-network: tests set mockNetwork.type.
export enum NetworkStateType {
  NONE = 'NONE',
  UNKNOWN = 'UNKNOWN',
  CELLULAR = 'CELLULAR',
  WIFI = 'WIFI',
  ETHERNET = 'ETHERNET'
}
export const mockNetwork = { type: NetworkStateType.WIFI as NetworkStateType }
export const getNetworkStateAsync = jest.fn(async () => ({
  type: mockNetwork.type,
  isConnected: mockNetwork.type !== NetworkStateType.NONE,
  isInternetReachable: mockNetwork.type !== NetworkStateType.NONE
}))
