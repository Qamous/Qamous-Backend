# UrbanDictionaryAR Backend

## Description
The UrbanDictionaryAR Backend serves as the server-side component of the UrbanDictionaryAR application, which is a platform for users to contribute and explore definitions of Arabic and Franco-Arabic words. The backend is responsible for handling user authentication, word and definition management, as well as user interactions such as liking, disliking, and reporting definitions.

## Technologies Used
- **Nest.js**: A progressive Node.js framework for building efficient, reliable, and scalable server-side applications.
- **MySQL**: A popular open-source relational database management system used for storing and managing data.
- **TypeORM**: An Object-Relational Mapping (ORM) library for TypeScript and JavaScript that simplifies database interactions.

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
- **GET /users/{userID}**: Get user profile information.
- **PATCH /users/{userID}**: Update user profile information.

### Word Management
- **POST /words**: Add a new word to the dictionary.
- **GET /words/{wordID}**: Get details of a specific word.
- **GET /words/search**: Search for words by keyword or filter by country of use.

### Definition Management
- **POST /definitions**: Add a new definition to a word.
- **GET /definitions/{definitionID}**: Get details of a specific definition.
- **POST /definitions/{definitionID}/like**: Like a definition.
- **POST /definitions/{definitionID}/dislike**: Dislike a definition.
- **POST /definitions/{definitionID}/report**: Report a definition.

## Schema Details
The database schema for UrbanDictionaryAR consists of the following tables:
- **Users**: Stores user information, including username, email, password hash, profile picture, and likes received.
- **Words**: Stores information about words, including Arabic and Franco-Arabic representations, countries of use, and report count.
- **Countries**: Contains a list of countries with their ISO 3166-1 alpha-2 country codes.
- **Definitions**: Stores definitions of words, along with associated metadata such as example sentences, timestamps, like count, and user ID.
- **DefinitionLikesDislikes**: Records likes and dislikes for definitions, linked with user IDs.
- **WordReports**: Tracks reports for words, including the reason for reporting and the user who reported it.

## Contributors
- [Your Name](https://github.com/your-username)

## License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
