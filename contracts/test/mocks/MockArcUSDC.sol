// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Circle's FiatToken as Arc actually behaves: one balance wearing two
/// faces. Moving the 6-decimal token moves the 18-decimal native balance with
/// it, because they are the same money.
///
/// @dev Arc's real USDC cannot be exercised on a fork — its transfers run
/// through node-level precompiles with no bytecode — so the property this
/// contract exists to model is the one the mandate depends on and no fork can
/// demonstrate. It pushes native with a plain call, which is the harsher of
/// the two possible node behaviours: if the mandate survives a recipient hook
/// firing, it also survives a silent balance credit.
contract MockArcUSDC {
    string public constant name = "USDC";
    string public constant version = "2";
    uint8 public constant decimals = 6;
    uint256 private constant SCALE = 1e12;

    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267;
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(bytes32 => bool)) public authorizationState;

    error InvalidSignature();
    error AuthorizationExpired();
    error AuthorizationNotYetValid();
    error AuthorizationAlreadyUsed();
    error InsufficientBalance();
    error NativeMirrorFailed();

    function mint(address to, uint256 value) external {
        balanceOf[to] += value;
    }

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                block.chainid,
                address(this)
            )
        );
    }

    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        if (block.timestamp <= validAfter) revert AuthorizationNotYetValid();
        if (block.timestamp >= validBefore) revert AuthorizationExpired();
        if (authorizationState[from][nonce]) revert AuthorizationAlreadyUsed();

        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
        if (ecrecover(digest, v, r, s) != from) revert InvalidSignature();
        if (balanceOf[from] < value) revert InsufficientBalance();

        authorizationState[from][nonce] = true;
        balanceOf[from] -= value;
        balanceOf[to] += value;

        (bool ok,) = payable(to).call{value: value * SCALE}("");
        if (!ok) revert NativeMirrorFailed();
    }

    receive() external payable {}
}
