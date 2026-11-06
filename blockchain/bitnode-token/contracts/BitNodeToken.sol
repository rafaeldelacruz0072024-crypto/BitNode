// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Fixed-supply rewards token intended for BNB Smart Chain.
/// @dev Owner identifies the treasury; ownership grants no minting, seizure or tax powers.
contract BitNodeToken is ERC20, ERC20Burnable, Ownable {
    uint256 public constant INITIAL_SUPPLY = 11_000_000 * 10 ** 18;
    error InvalidSymbol();

    constructor(string memory tokenSymbol, address treasury)
        ERC20("BitNode", tokenSymbol)
        Ownable(treasury)
    {
        if (bytes(tokenSymbol).length == 0) revert InvalidSymbol();
        _mint(treasury, INITIAL_SUPPLY);
    }

    /// @notice BEP-20 owner compatibility getter.
    function getOwner() external view returns (address) {
        return owner();
    }
}
