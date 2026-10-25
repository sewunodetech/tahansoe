import { parseAbi } from "viem";

/**
 * ERC-8004 Identity Registry ABI.
 * Spec: https://eips.ethereum.org/EIPS/eip-8004
 */
export const identityRegistryAbi = parseAbi([
  "function register(string agentURI) external returns (uint256 agentId)",
  "function register(string agentURI, (string metadataKey, bytes metadataValue)[] metadata) external returns (uint256 agentId)",
  "function setAgentURI(uint256 agentId, string newURI) external",
  "function getAgentWallet(uint256 agentId) external view returns (address)",
  "function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes signature) external",
  "function ownerOf(uint256 tokenId) external view returns (address)",
  "function tokenURI(uint256 tokenId) external view returns (string)",
  "function name() external view returns (string)",
  "function symbol() external view returns (string)",
  "function balanceOf(address owner) external view returns (uint256)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
  "event AgentWalletSet(uint256 indexed agentId, address wallet)",
  "event AgentURISet(uint256 indexed agentId, string newURI)",
]);

/**
 * ERC-8004 Reputation Registry ABI.
 * Spec: https://eips.ethereum.org/EIPS/eip-8004
 */
export const reputationRegistryAbi = parseAbi([
  "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash) external",
  "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) external view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
  "function getClients(uint256 agentId) external view returns (address[])",
  "function getIdentityRegistry() external view returns (address)",
  "event NewFeedback(uint256 indexed agentId, address indexed clientAddress, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
]);
