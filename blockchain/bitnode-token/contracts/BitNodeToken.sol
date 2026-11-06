// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Fixed-supply rewards token intended for BNB Smart Chain.
/// @dev Owner identifies the treasury; ownership grants no minting, seizure or tax powers.
contract BitNodeToken is ERC20, Ownable {
    error InvalidSupply();
    error InvalidSymbol();

    /// @param supplyBaseUnits Supply in smallest units (18 decimals), NOT whole tokens.
    constructor(string memory tokenSymbol, uint256 supplyBaseUnits, address treasury)
        ERC20("BitNode", tokenSymbol)
        Ownable(treasury)
    {
        if (supplyBaseUnits == 0) revert InvalidSupply();
        if (bytes(tokenSymbol).length == 0) revert InvalidSymbol();
        _mint(treasury, supplyBaseUnits);
    }

    /// @notice BEP-20 owner compatibility getter.
    function getOwner() external view returns (address) {
        return owner();
    }
}
