// PACKAGES
import { ArrayNotEmpty, IsArray, IsObject, validateSync } from 'class-validator';

// SERVICES
import { AccountService } from "../../services/accounts/AccountService";
import { TweetService } from "../../services/data/TweetService";
import { UserService } from "../../services/data/UserService";

// INTERFACES
import { CursoredDataInterface } from "../interfaces/Service";

// TYPES
import { DataValidationError } from './Errors';

/**
 * The cursor to the batch of data to be fetched.
 * 
 * @public
 */
export class Cursor {
    // MEMBER DATA
    /** The cursor string. */
    value: string;

    // MEMBER DATA
    /**
     * Initializes a new cursor from the given cursor string.
     * 
     * @param cursorStr The string representation of the cursor.
     */
    constructor(cursorStr: string) {
        this.value = cursorStr;
    }
}

/**
 * The data that us fetched batch-wise along with a cursor.
 * 
 * @typeParam Type - The type of data present in the list.
 * @public
 */
export class CursoredData<T> implements CursoredDataInterface<T> {
    /** The list of data of the given type. */
    @IsArray()
    @ArrayNotEmpty({ message: "No data matching the given criteria found!" })
    list: T[];

    /** The cursor to the next batch of data. */
    @IsObject()
    next: Cursor;

    /**
     * @param list The list of data item to store.
     * @param next The cursor to the next batch of data.
     */
    constructor(list: T[] = [], next: string = '') {
        this.list = list;
        this.next = new Cursor(next);

        // Validating the list data
        const validationResult = validateSync(this);

        // If validation error occured
        if (validationResult.length) {
            throw new DataValidationError(validationResult);
        }
    }
}

/**
 * The data context from where data is to be fetched.
 * 
 * @public
 */
export interface DataContext {
    /** Handles data related to users. */
    users: UserService,

    /** Handles data related to tweets. */
    tweets: TweetService,

    /** Handles account related operations. */
    account: AccountService
}