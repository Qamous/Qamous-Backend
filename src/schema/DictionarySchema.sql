-- Create a table to store users
CREATE TABLE Users
(
    UserID         INT PRIMARY KEY AUTO_INCREMENT,
    Username       TEXT NOT NULL,
    EmailAddress   TEXT NOT NULL,
    PasswordHash   TEXT NOT NULL, -- Store securely hashed and salted passwords
    FullName       TEXT,
    ProfilePicture TEXT,          -- Store the URL or reference to the profile picture
    DateOfBirth    DATE,
    LikesReceived  INT DEFAULT 0, -- Count of likes received on definitions by other users
    CountryCode    CHAR(2),       -- ISO 3166-1 alpha-2 country code
    FOREIGN KEY (CountryCode) REFERENCES Countries (CountryCode)
);

-- Create a table to store words, supporting Arabic and Franco-Arabic
CREATE TABLE Words
(
    WordID           INT PRIMARY KEY AUTO_INCREMENT,
    ArabicWord       TEXT NOT NULL,
    FrancoArabicWord TEXT,
    CountriesOfUse   TEXT,         -- Store comma-separated list of country codes
    ReportCount      INT DEFAULT 0 -- Count of reports received on the word
);

-- Create a table to store countries
CREATE TABLE Countries
(
    CountryCode CHAR(2) PRIMARY KEY, -- ISO 3166-1 alpha-2 country code
    CountryName TEXT NOT NULL
);

-- Create a table to store definitions
-- (When a user adds a definition, always make sure that the word is already in the Words table, the user is already in
-- the Users table, and if this definition is in English, the word will have at least 1 Arabic definition and there
-- exists a Franco-Arabic translation for the word)
CREATE TABLE Definitions
(
    DefinitionID   INT PRIMARY KEY AUTO_INCREMENT,
    WordID         INT  NOT NULL,
    UserID         INT,
    Definition     TEXT NOT NULL,                      -- The definition of the word in Arabic or Franco-Arabic
    Example        TEXT     DEFAULT NULL,              -- Optional example sentence
    IsArabic       BOOLEAN  DEFAULT TRUE,              -- Indicates if the definition is in Arabic or Franco-Arabic
    AddedTimestamp DATETIME DEFAULT CURRENT_TIMESTAMP, -- Store the date and time when the definition was added
    LikeCount      INT      DEFAULT 0,                 -- Count of likes received on the definition
    DislikeCount   INT      DEFAULT 0,                 -- Count of dislikes received on the definition
    FOREIGN KEY (WordID) REFERENCES Words (WordID),
    FOREIGN KEY (UserID) REFERENCES Users (UserID)
);

-- Create a table to store likes/dislikes for definitions
CREATE TABLE DefinitionLikesDislikes
(
    DefinitionID INT NOT NULL,
    UserID       INT NOT NULL,
    Liked        BOOLEAN, -- TRUE for like, FALSE for dislike
    PRIMARY KEY (DefinitionID, UserID),
    FOREIGN KEY (DefinitionID) REFERENCES Definitions (DefinitionID),
    FOREIGN KEY (UserID) REFERENCES Users (UserID)
);

CREATE TABLE WordReports
(
    ReportID   INT PRIMARY KEY AUTO_INCREMENT,
    WordID     INT NOT NULL, -- The word being reported
    UserID     INT NOT NULL, -- The user who reported the word
    ReportText TEXT,         -- The reason for reporting the word
    FOREIGN KEY (WordID) REFERENCES Words (WordID),
    FOREIGN KEY (UserID) REFERENCES Users (UserID)
);
