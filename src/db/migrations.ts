// src/db/migrations.ts

import { MigrationInterface, QueryRunner } from 'typeorm';

export class ImprovedDatabaseSchema1618483870000 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE sessions (
                id SERIAL PRIMARY KEY,
                session_token VARCHAR(255) NOT NULL,
                user_id INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW() ON UPDATE NOW(),
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
        `);

        await queryRunner.query(`
            CREATE TABLE user_context (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                context JSONB NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
        `);

        await queryRunner.query(`
            ALTER TABLE embeddings ADD COLUMN user_context_id INTEGER;
            ALTER TABLE embeddings ADD CONSTRAINT fk_user_context FOREIGN KEY (user_context_id) REFERENCES user_context(id);
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DROP TABLE IF EXISTS sessions;
            DROP TABLE IF EXISTS user_context;
        `);

        await queryRunner.query(`
            ALTER TABLE embeddings DROP CONSTRAINT fk_user_context;
            ALTER TABLE embeddings DROP COLUMN user_context_id;
        `);
    }
}