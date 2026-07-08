-- SQL Dump of periodic table database
-- Original source: https://github.com/neondatabase-labs/postgres-sample-dbs/blob/main/periodic_table.sql

-- Drop tables if they exist to allow rerunning this script
DROP TABLE IF EXISTS properties;
DROP TABLE IF EXISTS elements;
DROP TABLE IF EXISTS types;

CREATE TABLE elements (
    atomic_number integer NOT NULL,
    symbol character varying(2) NOT NULL,
    name character varying(40) NOT NULL
);

CREATE TABLE properties (
    atomic_number integer NOT NULL,
    type character varying(30) NOT NULL,
    atomic_mass decimal NOT NULL,
    melting_point_celsius decimal,
    boiling_point_celsius decimal,
    type_id integer NOT NULL
);

CREATE TABLE types (
    type_id integer NOT NULL,
    type character varying(30) NOT NULL
);

ALTER TABLE ONLY elements
    ADD CONSTRAINT elements_pkey PRIMARY KEY (atomic_number);

ALTER TABLE ONLY properties
    ADD CONSTRAINT properties_pkey PRIMARY KEY (atomic_number);

ALTER TABLE ONLY types
    ADD CONSTRAINT types_pkey PRIMARY KEY (type_id);

ALTER TABLE ONLY properties
    ADD CONSTRAINT properties_atomic_number_fkey FOREIGN KEY (atomic_number) REFERENCES elements(atomic_number);

ALTER TABLE ONLY properties
    ADD CONSTRAINT properties_type_id_fkey FOREIGN KEY (type_id) REFERENCES types(type_id);

INSERT INTO elements VALUES (1, 'H', 'Hydrogen');
INSERT INTO elements VALUES (2, 'He', 'Helium');
INSERT INTO elements VALUES (3, 'Li', 'Lithium');
INSERT INTO elements VALUES (4, 'Be', 'Beryllium');
INSERT INTO elements VALUES (5, 'B', 'Boron');
INSERT INTO elements VALUES (6, 'C', 'Carbon');
INSERT INTO elements VALUES (7, 'N', 'Nitrogen');
INSERT INTO elements VALUES (8, 'O', 'Oxygen');
INSERT INTO elements VALUES (9, 'F', 'Fluorine');
INSERT INTO elements VALUES (10, 'Ne', 'Neon');

INSERT INTO types VALUES (1, 'nonmetal');
INSERT INTO types VALUES (2, 'noble gas');
INSERT INTO types VALUES (3, 'alkali metal');
INSERT INTO types VALUES (4, 'alkaline earth metal');
INSERT INTO types VALUES (5, 'metalloid');
INSERT INTO types VALUES (6, 'halogen');

INSERT INTO properties VALUES (1, 'nonmetal', 1.008, -259.1, -252.9, 1);
INSERT INTO properties VALUES (2, 'noble gas', 4.0026, -272.2, -269, 2);
INSERT INTO properties VALUES (3, 'alkali metal', 6.94, 180.54, 1342, 3);
INSERT INTO properties VALUES (4, 'alkaline earth metal', 9.0122, 1287, 2470, 4);
INSERT INTO properties VALUES (5, 'metalloid', 10.81, 2075, 4000, 5);
INSERT INTO properties VALUES (6, 'nonmetal', 12.011, 3550, 4027, 1);
INSERT INTO properties VALUES (7, 'nonmetal', 14.007, -210.1, -195.8, 1);
INSERT INTO properties VALUES (8, 'nonmetal', 15.999, -218, -183, 1);
INSERT INTO properties VALUES (9, 'halogen', 18.998, -220, -188.1, 6);
INSERT INTO properties VALUES (10, 'noble gas', 20.18, -248.6, -246.1, 2);
