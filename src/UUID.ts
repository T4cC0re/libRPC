/*
 *    Copyright 2016 Hendrik 'T4cC0re' Meyer
 *
 *    Licensed under the Apache License, Version 2.0 (the "License");
 *    you may not use this file except in compliance with the License.
 *    You may obtain a copy of the License at
 *
 *        http://www.apache.org/licenses/LICENSE-2.0
 *
 *    Unless required by applicable law or agreed to in writing, software
 *    distributed under the License is distributed on an "AS IS" BASIS,
 *    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *    See the License for the specific language governing permissions and
 *    limitations under the License.
 *
 */
'use strict';

import {randomBytes} from 'crypto'

export class UUID {
    public static new = (): string => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
        .replace(
            /[xy]/g,
            char => {
                const rnd = parseInt(
                    randomBytes(1)
                        .toString('hex')
                        .slice(0, 1),
                    16
                );
                return ((char == 'x') ? rnd : (rnd & 0x3 | 0x8)).toString(16);
            }
        );
}
