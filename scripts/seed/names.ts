/**
 * Name pools, grouped by region.
 *
 * Names are drawn to match the employee's country, so the directory reads like
 * a genuinely multinational org rather than 10,000 people called Smith. This is
 * not decoration: the directory search, the sort-by-surname index and the CSV
 * export are all exercised more honestly by names with varied lengths, accents
 * and word counts than they would be by generated filler.
 *
 * `OTHER` and `UNDISCLOSED` genders draw from both first-name pools, since
 * neither implies anything about a person's name.
 */

export interface NamePool {
  readonly femaleFirst: readonly string[];
  readonly maleFirst: readonly string[];
  readonly last: readonly string[];
}

const ANGLO: NamePool = {
  femaleFirst: ['Amelia', 'Olivia', 'Charlotte', 'Grace', 'Hannah', 'Isla', 'Freya', 'Ruby', 'Chloe', 'Megan', 'Naomi', 'Sophie', 'Eleanor', 'Alice', 'Maya', 'Zara', 'Nadia', 'Rachel', 'Bethany', 'Imogen'],
  maleFirst: ['Oliver', 'Harry', 'Jack', 'Thomas', 'James', 'Ethan', 'Noah', 'Liam', 'Samuel', 'Callum', 'Dylan', 'Marcus', 'Nathan', 'Aaron', 'Joel', 'Elliot', 'Isaac', 'Rory', 'Declan', 'Fraser'],
  last: ['Smith', 'Jones', 'Taylor', 'Brown', 'Wilson', 'Evans', 'Thomas', 'Roberts', 'Walker', 'Wright', 'Robinson', 'Thompson', 'Hughes', 'Edwards', 'Green', 'Baker', 'Carter', 'Mitchell', 'Bennett', 'Fletcher', 'Sinclair', 'Whitfield', 'Osborne', 'Ashworth', 'Quinn'],
};

const GERMAN: NamePool = {
  femaleFirst: ['Anna', 'Lena', 'Marie', 'Sophia', 'Emilia', 'Hannah', 'Johanna', 'Katharina', 'Franziska', 'Leonie', 'Charlotte', 'Greta', 'Antonia', 'Helena', 'Clara'],
  maleFirst: ['Lukas', 'Jonas', 'Felix', 'Maximilian', 'Elias', 'Paul', 'Moritz', 'Sebastian', 'Tobias', 'Fabian', 'Julian', 'Matthias', 'Andreas', 'Stefan', 'Niklas'],
  last: ['Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Wagner', 'Becker', 'Hoffmann', 'Schäfer', 'Koch', 'Bauer', 'Richter', 'Klein', 'Wolf', 'Neumann', 'Schwarz', 'Zimmermann', 'Braun', 'Krüger', 'Hofmann'],
};

const POLISH: NamePool = {
  femaleFirst: ['Zofia', 'Julia', 'Maja', 'Hanna', 'Alicja', 'Lena', 'Aleksandra', 'Natalia', 'Wiktoria', 'Katarzyna', 'Agnieszka', 'Magdalena', 'Karolina', 'Ewa', 'Iwona'],
  maleFirst: ['Jakub', 'Kacper', 'Filip', 'Szymon', 'Piotr', 'Michał', 'Tomasz', 'Marcin', 'Paweł', 'Krzysztof', 'Bartosz', 'Wojciech', 'Adam', 'Grzegorz', 'Rafał'],
  last: ['Nowak', 'Kowalski', 'Wiśniewski', 'Wójcik', 'Kowalczyk', 'Kamiński', 'Lewandowski', 'Zieliński', 'Szymański', 'Woźniak', 'Dąbrowski', 'Kozłowski', 'Jankowski', 'Mazur', 'Krawczyk', 'Piotrowski', 'Grabowski', 'Pawłowski'],
};

const BRAZILIAN: NamePool = {
  femaleFirst: ['Ana', 'Beatriz', 'Camila', 'Fernanda', 'Juliana', 'Larissa', 'Mariana', 'Patrícia', 'Renata', 'Luciana', 'Gabriela', 'Isabela', 'Carolina', 'Vitória', 'Letícia'],
  maleFirst: ['João', 'Pedro', 'Lucas', 'Gabriel', 'Rafael', 'Thiago', 'Bruno', 'Felipe', 'Gustavo', 'Rodrigo', 'Matheus', 'Eduardo', 'Vinícius', 'Leonardo', 'André'],
  last: ['Silva', 'Santos', 'Oliveira', 'Souza', 'Rodrigues', 'Ferreira', 'Alves', 'Pereira', 'Lima', 'Gomes', 'Costa', 'Ribeiro', 'Martins', 'Carvalho', 'Almeida', 'Barbosa', 'Rocha', 'Dias'],
};

const INDIAN: NamePool = {
  femaleFirst: ['Aditi', 'Ananya', 'Divya', 'Ishita', 'Kavya', 'Meera', 'Neha', 'Pooja', 'Priya', 'Riya', 'Sanjana', 'Shreya', 'Sneha', 'Swati', 'Tanvi', 'Anjali', 'Deepika', 'Lakshmi', 'Nandini', 'Rhea'],
  maleFirst: ['Aarav', 'Aditya', 'Akash', 'Arjun', 'Deepak', 'Karthik', 'Manish', 'Nikhil', 'Pranav', 'Rahul', 'Rohit', 'Sanjay', 'Siddharth', 'Varun', 'Vikram', 'Abhishek', 'Harsh', 'Kunal', 'Rajesh', 'Yash'],
  last: ['Sharma', 'Verma', 'Patel', 'Reddy', 'Nair', 'Iyer', 'Kumar', 'Singh', 'Gupta', 'Mehta', 'Joshi', 'Desai', 'Rao', 'Bose', 'Chatterjee', 'Menon', 'Pillai', 'Kulkarni', 'Malhotra', 'Bhat'],
};

const JAPANESE: NamePool = {
  femaleFirst: ['Yui', 'Aoi', 'Sakura', 'Hana', 'Rin', 'Mei', 'Akari', 'Yuna', 'Haruka', 'Nanami', 'Kaori', 'Misaki', 'Ayumi', 'Chihiro', 'Emi'],
  maleFirst: ['Haruto', 'Sota', 'Yuto', 'Ren', 'Riku', 'Kaito', 'Takumi', 'Daiki', 'Kenji', 'Shota', 'Hiroshi', 'Naoki', 'Yusuke', 'Tatsuya', 'Kazuki'],
  last: ['Sato', 'Suzuki', 'Takahashi', 'Tanaka', 'Watanabe', 'Ito', 'Yamamoto', 'Nakamura', 'Kobayashi', 'Kato', 'Yoshida', 'Yamada', 'Sasaki', 'Matsumoto', 'Inoue', 'Kimura', 'Hayashi', 'Shimizu'],
};

const SINGAPOREAN: NamePool = {
  femaleFirst: ['Wei Ling', 'Hui Min', 'Jia Yi', 'Xin Yi', 'Siti', 'Nurul', 'Priya', 'Rachel', 'Cheryl', 'Joanne', 'Michelle', 'Shu Fen', 'Li Ying', 'Farah', 'Denise'],
  maleFirst: ['Wei Jie', 'Jun Hao', 'Zhi Hao', 'Yong Sheng', 'Muhammad', 'Aiman', 'Ravi', 'Daryl', 'Marcus', 'Jason', 'Kenneth', 'Wen Bin', 'Kai Xiang', 'Farhan', 'Terence'],
  last: ['Tan', 'Lim', 'Lee', 'Ng', 'Wong', 'Chan', 'Koh', 'Goh', 'Ong', 'Teo', 'Chua', 'Yeo', 'Sim', 'Bin Rahman', 'Kaur', 'Rajaratnam', 'Loh', 'Toh'],
};

const POOLS_BY_COUNTRY: Readonly<Record<string, NamePool>> = {
  US: ANGLO,
  GB: ANGLO,
  CA: ANGLO,
  AU: ANGLO,
  DE: GERMAN,
  PL: POLISH,
  BR: BRAZILIAN,
  IN: INDIAN,
  JP: JAPANESE,
  SG: SINGAPOREAN,
};

export function namePoolFor(countryCode: string): NamePool {
  return POOLS_BY_COUNTRY[countryCode] ?? ANGLO;
}

/**
 * Strip accents and non-ASCII so an email address is deliverable.
 * "Wiśniewski" becomes "wisniewski"; "Müller" becomes "muller".
 */
export function toEmailToken(name: string): string {
  return name
    .normalize('NFD')
    // Combining diacritical marks, left behind by the NFD decomposition above.
    .replace(/[̀-ͯ]/g, '')
    // ł does not decompose under NFD, so it needs handling by hand.
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '');
}
