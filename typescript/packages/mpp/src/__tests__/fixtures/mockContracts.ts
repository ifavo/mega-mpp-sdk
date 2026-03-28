import solc from "solc";
import type { Abi, Hex } from "viem";

type SolcContract = {
  abi: Abi;
  evm?: {
    bytecode?: {
      object?: string;
    };
  };
};

type SolcOutput = {
  contracts?: Record<string, Record<string, SolcContract>>;
  errors?: Array<{
    formattedMessage: string;
    severity: "error" | "warning";
  }>;
};

type CompiledContract = {
  abi: Abi;
  bytecode: Hex;
};

const SOURCE = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Like {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public immutable decimals;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Transfer(address indexed from, address indexed to, uint256 value);

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "Approve Permit2 for the payment token amount before retrying.");

        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }

        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "Fund the payer wallet before retrying the payment.");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

contract MockPermit2 {
    string constant SINGLE_WITNESS_TYPE_STRING =
        "ChargeWitness witness)ChargeWitness(TransferDetails transferDetails)TokenPermissions(address token,uint256 amount)TransferDetails(address to,uint256 requestedAmount)";
    string constant BATCH_WITNESS_TYPE_STRING =
        "ChargeBatchWitness witness)ChargeBatchWitness(TransferDetails[] transferDetails)TokenPermissions(address token,uint256 amount)TransferDetails(address to,uint256 requestedAmount)";

    struct TokenPermissions {
        address token;
        uint256 amount;
    }

    struct PermitTransferFrom {
        TokenPermissions permitted;
        uint256 nonce;
        uint256 deadline;
    }

    struct SignatureTransferDetails {
        address to;
        uint256 requestedAmount;
    }

    struct PermitBatchTransferFrom {
        TokenPermissions[] permitted;
        uint256 nonce;
        uint256 deadline;
    }

    mapping(address => mapping(uint256 => bool)) public usedNonces;
    address public failRecipientAfterFirstSuccess;
    uint256 public successfulTransfers;

    function setFailRecipientAfterFirstSuccess(address recipient) external {
        failRecipientAfterFirstSuccess = recipient;
    }

    function permitWitnessTransferFrom(
        PermitTransferFrom calldata permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes32,
        string calldata witnessTypeString,
        bytes calldata
    ) external {
        _consumePermit(owner, permit.nonce, permit.deadline);
        require(
            keccak256(bytes(witnessTypeString)) == keccak256(bytes(SINGLE_WITNESS_TYPE_STRING)),
            "Use the canonical single-transfer witness type string before retrying the payment."
        );
        require(
            transferDetails.requestedAmount == permit.permitted.amount,
            "Use the exact requested amount before retrying the payment."
        );
        require(
            !(
                successfulTransfers > 0 &&
                transferDetails.to == failRecipientAfterFirstSuccess
            ),
            "Retry after the split transfer settles successfully."
        );
        require(
            IERC20Like(permit.permitted.token).transferFrom(
                owner,
                transferDetails.to,
                transferDetails.requestedAmount
            ),
                "Retry after the payment token transfer succeeds."
            );
        successfulTransfers += 1;
    }

    function permitWitnessTransferFrom(
        PermitBatchTransferFrom calldata permit,
        SignatureTransferDetails[] calldata transferDetails,
        address owner,
        bytes32,
        string calldata witnessTypeString,
        bytes calldata
    ) external {
        _consumePermit(owner, permit.nonce, permit.deadline);
        require(
            keccak256(bytes(witnessTypeString)) == keccak256(bytes(BATCH_WITNESS_TYPE_STRING)),
            "Use the canonical batch witness type string before retrying the payment."
        );
        require(
            transferDetails.length == permit.permitted.length,
            "Use the exact split layout from the challenge before retrying."
        );

        for (uint256 index = 0; index < transferDetails.length; index += 1) {
            require(
                transferDetails[index].requestedAmount == permit.permitted[index].amount,
                "Use the requested split amounts before retrying the payment."
            );
            require(
                IERC20Like(permit.permitted[index].token).transferFrom(
                    owner,
                    transferDetails[index].to,
                    transferDetails[index].requestedAmount
                ),
                "Retry after every split transfer succeeds."
            );
        }
    }

    function _consumePermit(address owner, uint256 nonce, uint256 deadline) internal {
        require(block.timestamp <= deadline, "Use a Permit2 payload with a future deadline before retrying.");
        require(!usedNonces[owner][nonce], "Request a fresh payment challenge before retrying.");
        usedNonces[owner][nonce] = true;
    }
}
`;

let compiled:
  | {
      mockErc20: CompiledContract;
      mockPermit2: CompiledContract;
    }
  | undefined;

export function compileMockContracts(): {
  mockErc20: CompiledContract;
  mockPermit2: CompiledContract;
} {
  if (compiled) return compiled;

  const input = {
    language: "Solidity",
    settings: {
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode"],
        },
      },
    },
    sources: {
      "MegaMocks.sol": {
        content: SOURCE,
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input))) as SolcOutput;
  const errors =
    output.errors?.filter((error) => error.severity === "error") ?? [];
  if (errors.length) {
    throw new Error(errors.map((error) => error.formattedMessage).join("\n"));
  }

  const contracts = output.contracts?.["MegaMocks.sol"];
  const mockErc20 = contracts?.["MockERC20"];
  const mockPermit2 = contracts?.["MockPermit2"];

  if (
    !mockErc20?.evm?.bytecode?.object ||
    !mockPermit2?.evm?.bytecode?.object
  ) {
    throw new Error(
      "Compile the mock MegaETH contracts successfully before running integration tests.",
    );
  }

  compiled = {
    mockErc20: {
      abi: mockErc20.abi,
      bytecode: `0x${mockErc20.evm.bytecode.object}`,
    },
    mockPermit2: {
      abi: mockPermit2.abi,
      bytecode: `0x${mockPermit2.evm.bytecode.object}`,
    },
  };

  return compiled;
}
