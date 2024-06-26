# Qamous Backend

## Description
The Qamous Backend serves as the server-side component of the Qamous application, which is a platform for users to 
contribute and explore definitions of Arabic and Franco-Arabic words. The backend is responsible for handling user 
authentication, word and definition management, as well as user interactions such as liking, disliking, and reporting 
definitions.

**If you're looking for the Front-End, find it [here](https://github.com/anthonyyoussef01/Qamous).


## Technologies Used
- **Nest.js**: A TypeScript-based Node.js framework.
- **MySQL**: An open-source relational database management system.
- **TypeORM**: An Object-Relational Mapping (ORM) library that simplifies database 
interactions.
- **REST API**: Follows the Representational State Transfer architectural style for designing networked applications.
- **Jest**: The testing framework used for unit and integration tests.
- **Express Session**: A middleware for Express.js that manages session state in a Node.js application.
- **Passport.js**: An authentication middleware for Node.js that supports a lot of authentication strategies.


## Setup Instructions
1. Clone the repository: `git clone <repository-url>`
2. Navigate to the project directory: `cd urban-dictionary-ar-backend`
3. Install dependencies: `npm install`
4. Configure environment variables:
    - Create a `.env` file in the root directory.
    - Define the following environment variables:
      ```
      PORT=3000
      DB_HOST=<your-database-host>
      DB_PORT=<your-database-port>
      DB_USERNAME=<your-database-username>
      DB_PASSWORD=<your-database-password>
      DB_NAME=<your-database-name>
      ```
5. Start the server: `npm run start`


## API Endpoints
### User Management
- **POST /users/register**: Register a new user.
- **POST /users/login**: Authenticate a user and generate a JWT token.
- **GET /users**: Get a list of all users.
- **GET /users/{userID}**: Get user profile information.
- **PATCH /users/{userID}**: Update user profile information.
- **DELETE /users/{userID}**: Delete a user account.

### Countries Management
- **GET /countries**: Retrieve all countries from the database.
- **GET /countries/:countryCode**: Retrieve a specific country by its ISO code.
- **POST /countries**: Add a new country to the database.
- **PATCH /countries/:countryCode**: Update an existing country.
- **DELETE /countries/:countryCode**: Delete a country from the database.

### Word Management
- **POST /word/add**: Add a new word to the dictionary.
- **GET /word/{wordID}**: Get details of a specific word.
- **GET /word/search/all**: Get a list of all words in the dictionary.
- **GET /word/search/iso={countryCode}**: Get a list of words used in a specific country.
- **GET /word/search/kwd={keyword}**: Search for words containing a specific keyword.

### Definition Management
- **GET /definitions**: Get a list of all definitions.
- **GET /definitions/{definitionID}**: Get details of a specific definition.
- **POST /definitions**: Add a new definition to a word.
- **PATCH /definitions/{definitionID}**: Update an existing definition.
- **DELETE /definitions/{definitionID}**: Delete a definition.
- **POST /definitions/{definitionID}/like**: Like a definition.
- **POST /definitions/{definitionID}/dislike**: Dislike a definition.
- **POST /definitions/{definitionID}/report**: Report a definition.

### Likes and Dislikes Management
- **POST /definitions/{definitionID}/likes**: Like a definition.
- **POST /definitions/{definitionID}/dislikes**: Dislike a definition.
- **GET /definitions/{definitionID}/likes-dislikes**: Get all likes and dislikes for a specific definition.
- **GET /definitions/{definitionID}/likes**: Get number of likes for a specific definition.
- **GET /definitions/{definitionID}/dislikes**: Get number of dislikes for a specific definition.
- **DELETE /definitions/{definitionID}/likes/{userID}**: Remove a like from a definition for a specific user.
- **DELETE /definitions/{definitionID}/dislikes/{userID}**: Remove a dislike from a definition for a specific user.

### Word Reports Management
- **POST /reports**: Add a new report to a word.
- **GET /reports**: Get a list of all word reports.
- **GET /reports/word/{wordID}**: Get reports for a specific word.
- **GET /reports/{reportID}**: Get details of a specific word report.
- **DELETE /reports/{reportID}**: Delete a word report.

## Schema Details
The database schema for UrbanDictionaryAR consists of the following tables:
- **Users**: Stores user information, including username, email, password hash, profile picture, and likes received.
- **Words**: Stores information about words, including Arabic and Franco-Arabic representations, countries of use, and 
report count.
- **Countries**: Contains a list of countries with their ISO 3166-1 alpha-2 country codes.
- **Definitions**: Stores definitions of words, along with associated metadata such as example sentences, timestamps, 
like count, and user ID.
- **DefinitionLikesDislikes**: Records likes and dislikes for definitions, linked with user IDs.
- **WordReports**: Tracks reports for words, including the reason for reporting and the user who reported it.


## Contributors
- [Anthony Elkommos Youssef](https://github.com/anthonyyoussef01)


## License
This project is licensed under the Mozilla Public License Version 2.0 - see the [LICENSE](LICENSE) file for details.
