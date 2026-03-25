import { parseAbi } from "viem";

export const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 amount)",
]);

export const PERMIT2_ABI = parseAbi([
  "function permitWitnessTransferFrom(((address token,uint256 amount) permitted,uint256 nonce,uint256 deadline) permit,(address to,uint256 requestedAmount) transferDetails,address owner,bytes32 witness,string witnessTypeString,bytes signature)",
  "function permitWitnessTransferFrom(((address token,uint256 amount)[] permitted,uint256 nonce,uint256 deadline) permit,(address to,uint256 requestedAmount)[] transferDetails,address owner,bytes32 witness,string witnessTypeString,bytes signature)",
]);
